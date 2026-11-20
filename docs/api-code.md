# API 取码：`GET /api/s/<token>/code`

用取件链接本身的 token 调一个接口，直接拿到最近一封邮件里的验证码，适合脚本、自动化流程或命令行用户；不用打开取件页。

- 规则与取件页相同：只看这个链接绑定的收件地址，只看规则组允许看的邮件（时间范围、过滤规则、`max_mails`、高危分类屏蔽都照常生效），被屏蔽的邮件即使含验证码也不返回。
- 只返回验证码和少量元信息（时间、发件人、收件地址，按规则组打码），**不返回主题和正文**。
- 每个链接都有"允许 API 取码"开关（`access.api`），默认开；在创建链接的第 3 步或链接侧板的"API 取码"里改。
- 接口地址在管理端链接侧板里显示（token 用 `<token>` 占位）；带完整 token 的地址在"复制链接"对话框里给出（取得完整链接会写审计）。

## 请求

```
GET <PUBLIC_ORIGIN>/api/s/<token>/code?since=<Unix 秒>&limit=<1–10>
X-Link-Password: <口令>              （链接设了口令时，口令只含 ASCII）
X-Link-Password-Base64: <base64>     （口令含中文等非 ASCII 字符时，改用这个）
```

| 参数 | 位置 | 说明 |
| --- | --- | --- |
| `token` | 路径 | 取件链接 `/s/<token>` 里的那一段 |
| `since` | 查询，可选 | Unix 秒；只看收到时间 **≥ since** 的邮件。常见用法：触发发码之前记下当前时间，轮询时带上它，避免拿到上一次的旧码 |
| `limit` | 查询，可选 | 1–10，默认 1；按收到时间从新到旧最多返回几封 |
| `X-Link-Password` | 请求头 | 链接设了口令时必填。**只接受 ASCII**，含非 ASCII 字符直接 400 `link_password_encoding` |
| `X-Link-Password-Base64` | 请求头 | 口令 UTF-8 字节的标准 base64（带 `=` 补齐），例如 `口令-1234` → `5Y+j5LukLTEyMzQ=`。与 `X-Link-Password` 只能给一个 |

为什么口令要分两个头：HTTP 头的值按字节传输，各客户端与运行时对非 ASCII 字节的处理不一致（实测 Workers 按 UTF-8 解码、坏字节被替换掉；Python `requests` 按 latin-1 编码，中文直接报错）。口令不进 URL，是为了不出现在代理和访问记录里。

不需要 Cookie，也不会设置 Cookie。响应带 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`。

## 响应（200）

```json
{
  "status": "ok",
  "code": "908172",
  "received_at": 1795177098,
  "received_at_iso": "2026-11-20T12:18:18.000Z",
  "mail_id": 21,
  "sender": { "domain": "login.example.org" },
  "mailbox": "pl***@example.com",
  "partial": false,
  "retry_after_sec": null,
  "remaining": { "total": 2, "today": null },
  "items": [
    { "code": "908172", "received_at": 1795177098, "received_at_iso": "2026-11-20T12:18:18.000Z", "mail_id": 21 }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `status` | `ok` 取到验证码 / `no_code` 没有验证码 / `pending` 邮件还在处理，稍后重试 |
| `code`、`received_at`、`received_at_iso`、`mail_id` | 最新一封（`items[0]`）的验证码、收到时间（Unix 秒与 ISO 8601 UTC）与邮件 id；没有时为 `null` |
| `sender` | 最新一封的发件人，按规则组"发件人显示"处理后的**对象**：`full` → `{ "address": "...", "name": "..." }`（有哪个给哪个），`domain` → `{ "domain": "..." }`，`name` → `{ "name": "..." }`；`hidden` 或取不到时为 `null` |
| `mailbox` | 最新一封的收件地址，按规则组"收件地址显示"处理：`full` 原样、`masked` 打码、`hidden` 为 `null` |
| `partial` | 扫描时遇到了还没解析完的邮件 |
| `retry_after_sec` | 建议多少秒后再请求：`no_code` 与 `pending` 时等于链接的轮询间隔（≥ 10 秒）；`ok` 与 `view_meta_only` 时为 `null` |
| `remaining` | 设了取码次数上限（点击取码）时的剩余次数：`total` 总次数、`today` 滚动 24 小时；没设的那项为 `null`；两项都没设（含自动显示的链接）时整体为 `null`。是本次计次**之后**的值 |
| `items` | 从新到旧的验证码列表，每项 `{ code, received_at, received_at_iso, mail_id }`，最多 `limit` 封 |
| `reason` | 只在 `view_meta_only` 时出现，见下 |

验证码提取顺序与取件页一致（temp_email 的 AI 提取 → 规则组的验证码正则 → 内置规则），**不看**规则组"提取内容"的勾选；但规则组视图是"仅元信息"（`meta_only`）时永远不返回验证码：

```json
{ "status": "no_code", "reason": "view_meta_only", "retry_after_sec": null, "code": null, "items": [], ... }
```

这种情况不必轮询，换规则组才行。

## 状态与错误码

错误响应统一为 `{ "error": { "code": "...", "message": "..." } }`，部分带额外字段。

| HTTP | `code` | 什么时候 | 怎么办 |
| --- | --- | --- | --- |
| 200 | （`status: ok`） | 取到验证码 | 用 `code` |
| 200 | （`status: no_code`） | 可见邮件里没有验证码，或 `since` 之后没有 | 按 `retry_after_sec` 重试 |
| 200 | （`status: no_code`，`reason: view_meta_only`） | 规则组只给元信息 | 不要重试 |
| 200 | （`status: pending`） | 比已检查过的邮件更新的邮件还在解析，尚未找到验证码 | 按 `retry_after_sec` 重试（不计次） |
| 400 | `validation_error` | `since` / `limit` 不合法；口令长度不在 4–128 | 改请求 |
| 400 | `link_password_encoding` | `X-Link-Password` 含非 ASCII；base64 无效或解码后不是 UTF-8；两个口令头同时出现 | 见"请求" |
| 400 | `link_password_required` | 链接设了口令但没给 | 带口令头 |
| 403 | `link_password_invalid` | 口令错误（计入口令锁定） | 检查口令 |
| 429 | `link_password_locked` | 口令错太多次被锁（与取件页共用计数）；带 `retry_after_at` 与 `Retry-After` | 等到 `Retry-After` 秒后 |
| 403 | `api_disabled` | 链接关闭了"允许 API 取码" | 联系链接提供者 |
| 403 | `turnstile_required` | 链接开了人机验证，脚本无法完成 | 只能用取件页，或让提供者关闭人机验证 |
| 403 | `link_not_yet_valid` | 未到生效时间；带 `valid_from` | 到时间再来 |
| 403 | `link_device_limit` | 设备名额已满且接口还没占到名额；带 `public_note` | 联系提供者重置设备 |
| 404 | `link_not_found` | token 不存在（含已重置 token 的旧链接） | — |
| 409 | `link_no_mailbox` | 链接下没有可用的收件地址 | 联系提供者 |
| 410 | `link_unavailable` | 已撤销 / 暂停 / 过期 / 总取码次数用尽 / IP 或国家不在白名单，不区分原因 | 停止轮询 |
| 429 | `link_daily_limit` | 滚动 24 小时次数已用完，且最新一封还没取过；带 `retry_after_at` 与 `Retry-After` | 等到 `Retry-After` 秒后 |
| 429 | `rate_limited` | 请求太频繁（同一链接 + 同一 IP 每 60 秒 120 次）；带 `Retry-After` | 降低频率 |
| 503 | `rule_group_invalid` | 链接的规则组配置损坏，失败关闭 | 联系提供者 |
| 503 | `mail_db_unhealthy` | 邮件库不可用 | 稍后重试 |
| 503 | `rate_limiter_not_configured` | 服务端缺限流配置 | 联系提供者 |

检查顺序：token → 状态 → 生效 / 过期 → IP / 国家 → 限流 → 总次数 → 是否允许 API → 人机验证 → 有无收件地址 → 口令 → `meta_only` → 设备 → 每日次数。

## 计次、设备、口令、人机验证

- **计次**：只对"点击取码"（`reveal = click`）的链接生效，自动显示的链接不计次。与取件页共用同一份取码记录和次数上限（`max_deliveries_total`、`max_deliveries_per_day`）：按**不同邮件**计，同一封无论在网页还是接口里取过，再取都不再计；并发请求也不会多计。`pending`、`no_code` 不计次。
- **额度不够时**：从最新一封开始逐封计次，遇到第一封计不了次就停，只返回它之前（更新）的那几封——例如 `limit=3` 但只剩 2 次，返回最新的 2 封。最新一封就计不了时：总次数用尽 → 410 `link_unavailable`；每日次数用尽 → 429 `link_daily_limit`。已经取过的邮件不受每日额度影响，照常返回。
- **设备**：接口整体占这个链接 **1 台设备**（管理端设备列表与预览里显示为 `api`），第一次成功调用时登记，等同在取件页点了"开始取码"——写入首次取码时间，"首次取码后 N 天失效"从这时开始计时。名额已被浏览器占满时返回 403 `link_device_limit`；反过来接口先占了名额，浏览器也会看到"设备已满"。管理员"重置设备"后接口下次调用重新登记。`meta_only` 的调用不登记设备、不激活链接。
- **口令**：每次请求都要带（接口没有 Cookie，不会记住你）。口令错误与取件页共用锁定计数：同一链接 + 同一 IP 15 分钟内错 5 次，或同一链接累计错 20 次，就会锁定一段时间。
- **人机验证**：开了人机验证的链接一律 403 `turnstile_required`。
- **访问日志**：每次调用在链接的访问日志里记一条"API 取码"，原因是结果（`ok` / `no_code` / `pending` / `view_meta_only`）或被拒原因；新计次的邮件另记一条"取码"。日志不记 token、口令和验证码。

## 轮询建议

1. 触发对方发验证码**之前**记下 `since = 当前 Unix 秒`（留几秒余量更稳）。
2. 带 `since` 请求；`status` 为 `no_code` 或 `pending` 时，按 `retry_after_sec` 等待后再请求。
3. `ok` 就停；`410` 停止；`429` 按 `Retry-After` 等待；`403`、`404`、`view_meta_only` 不要重试。
4. 设一个总超时（例如 3–5 分钟），超时就放弃。点击取码的链接每取到一封新邮件就用掉一次次数，不要用 `limit` 一次拉很多封。

## 示例

```sh
# 最新一封的验证码
curl -s 'https://mail.example.com/api/s/<token>/code'

# 带口令（ASCII）、只看 5 分钟内的邮件
curl -s -H 'X-Link-Password: open-sesame' \
  "https://mail.example.com/api/s/<token>/code?since=$(($(date +%s) - 300))"

# 口令含中文：发 UTF-8 字节的 base64
curl -s -H "X-Link-Password-Base64: $(printf '%s' '口令-1234' | base64)" \
  'https://mail.example.com/api/s/<token>/code'
```

最小 Python 轮询（只用标准库）：

```python
import base64, json, time, urllib.error, urllib.request

URL = "https://mail.example.com/api/s/<token>/code"
PASSWORD = None          # 有口令时填字符串
TIMEOUT_SEC = 300

def fetch_code(since):
    req = urllib.request.Request(f"{URL}?since={since}")
    if PASSWORD is not None:
        req.add_header("X-Link-Password-Base64", base64.b64encode(PASSWORD.encode("utf-8")).decode("ascii"))
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.load(resp), None
    except urllib.error.HTTPError as err:
        return err.code, json.load(err), err.headers.get("Retry-After")

since = int(time.time()) - 5      # 触发发码之前记下
# ……在这里触发对方发送验证码……
deadline = time.time() + TIMEOUT_SEC
while time.time() < deadline:
    status, body, retry_after = fetch_code(since)
    if status == 200 and body["status"] == "ok":
        print(body["code"])
        break
    if status == 200 and body.get("reason") != "view_meta_only":
        time.sleep(body["retry_after_sec"])
    elif status == 429:
        time.sleep(int(retry_after or 60))
    else:
        raise SystemExit(f"取码失败：{status} {body}")
else:
    raise SystemExit("超时，没有收到验证码")
```
