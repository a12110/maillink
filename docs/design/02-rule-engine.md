# 02 规则组设计（重点）

## 1. 三层模型

你提的三类需求（按发件人后缀、按时间、内容黑白名单）落在两层里，另外补一层链接自身的访问约束：

| 层 | 回答的问题 | 挂在哪 | 例子 |
| --- | --- | --- | --- |
| A 可见性 | 这封邮件**能不能被看到** | 规则组 | 只看 `@apple.com` 发来的；只看 10 分钟内的；含"重设密码"的不显示 |
| B 呈现 | 能看到的邮件**显示多少** | 规则组 | 只显示验证码；纯文本；隐藏链接；手机号打码 |
| C 访问约束 | 这个链接**能被谁、用多久、用几次** | 取件链接 | 30 分钟后失效；访问口令；首个访问者绑定 |

A、B 可复用，所以放规则组；C 每个链接各不相同，放链接上。用户授权只用到 A、B 和过期时间。

规则组改动**立即**对所有引用它的链接和授权生效。保存前界面显示"影响 N 个链接、M 个授权"。

## 2. 配置结构

存于 `rule_groups.config`，schema 用 zod 定义在 `packages/shared`，前后端共用。

```ts
type RuleGroupConfig = {
  time: {
    window_minutes?: number;          // 滚动窗口：只显示最近 N 分钟内收到的
    since: {
      type: 'none' | 'subject_created' | 'first_access' | 'fixed';
      at?: number;                    // type=fixed 时的 Unix 秒
      lookback_minutes?: number;      // 锚点往前多看几分钟，默认 0
    };
  };
  filter: {
    mode: 'whitelist' | 'blacklist';
    rules: Rule[];
  };
  present: {
    view: 'full' | 'text' | 'code_only' | 'meta_only';
    sender: 'full' | 'domain' | 'name' | 'hidden';
    recipient: 'full' | 'masked' | 'hidden';
    snippet: boolean;                 // 列表是否带正文预览
    links: 'keep' | 'strip' | { allow_domains: string[] };
    remote_images: 'block' | 'allow';
    attachments: 'hidden' | 'list' | 'download';
    redact: Redaction[];
    extract: Array<'code' | 'login_link'>;  // code_only 视图显示什么，默认 ['code']
    code_regex?: string;              // 覆盖默认验证码提取
  };
  limits: { max_mails?: number };     // 最多显示最新的 N 封
};

type Rule = { id: string; name: string; enabled: boolean; effect: 'allow' | 'deny'; when: Cond };

type Cond =
  | { all: Cond[] }                   // 全部满足
  | { any: Cond[] }                   // 任一满足
  | { not: Cond }
  | { field: Field; op: Op; value: string | string[] | number | boolean; case_sensitive?: boolean };

type Redaction = {
  name: string;
  match: { type: 'text' | 'regex'; pattern: string };
  scope: Array<'subject' | 'body'>;
  replace: string;                    // 例如 "***"
};
```

## 3. A 层：可见性

### 3.1 时间规则

有效时间下界 = 下面几项取**最大值**，并下推进 SQL（`created_at >= ?`）：

| 来源 | 计算 |
| --- | --- |
| `window_minutes` | 当前时间 − N 分钟 |
| `since.type = subject_created` | 链接或授权的创建时间 − `lookback_minutes` |
| `since.type = first_access` | 链接或授权的首次访问时间 − `lookback_minutes` |
| `since.type = fixed` | `at` |

- 时间基准是 `raw_mails.created_at`（入库时间），不是邮件的 `Date` 头。
- `subject_created` 很重要：把账号的收件链接给了新的人，他不应该看到给上一个人时的历史邮件。
- `first_access` 在首次访问前没有锚点，此时用"当前时间 − lookback"，即首次打开只看得到 lookback 内的邮件。
- `limits.max_mails`：过滤后只保留最新的 N 封，没有更多分页。
- 链接的"首次访问"指访客点了"开始取码"，不是页面被打开（见 §6）。
- 链接的锚点可以重置：`share_links.anchor_reset_at` 不为空时，锚点取它与原锚点中较晚的一个（售后换号时用）。

### 3.2 过滤规则的求值

与规则顺序无关，三步：

```
1. 任一启用的 deny 规则命中            → 不可见
2. mode = blacklist                     → 可见
3. mode = whitelist                     → 命中任一启用的 allow 规则才可见
```

- `whitelist` 模式下没有启用的 allow 规则 = 什么都看不到（界面给出警告）。这样"临时关掉唯一一条 allow 规则"不会变成全部可见。
- `blacklist` 模式下不允许出现 allow 规则（保存时校验报错，不静默忽略）。
- 多条 allow 规则之间是"或"，一条规则内部用 `all / any / not` 组合。

这和 fork 里 Webhook 过滤器的 `and / or / not` 节点思路一致，区别是子节点为多元、并多了一层 allow/deny。

### 3.3 可用字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `sender.address` | 文本列表 | 发件人候选地址：`From` 头与 `X-ICLOUD-HME` 的 `s=`（见 01 §4.1），任一满足即命中 |
| `sender.domain` | 域名列表 | 上述候选地址的域名 |
| `sender.name` | 文本 | `From` 显示名，可伪造，不要单独用来做白名单 |
| `sender.envelope` | 文本 | 信封发件人，高级用途 |
| `recipient` | 文本 | 多地址链接里按收件地址区分规则时用 |
| `subject` | 文本 | |
| `body` | 文本 | 纯文本与 HTML 转文本的合集，已归一化 |
| `content` | 文本 | `subject` + `body`，写关键词规则最常用 |
| `link.domains` | 域名列表 | 正文里出现的链接域名 |
| `code.present` | 布尔 | 是否提取到验证码 |
| `login_link.present` | 布尔 | 是否提取到登录链接（见 §4.6） |
| `category` | 枚举 | 内置邮件分类，见 §3.6 |
| `has_attachment` | 布尔 | |
| `attachment.name` | 文本列表 | |
| `size` | 数字 | 原文字节数 |

二期可加：`header.<Name>`、`auth.spf / dkim / dmarc`。

### 3.4 操作符

| 操作符 | 适用 | 说明 |
| --- | --- | --- |
| `eq` | 文本 | 相等 |
| `contains` | 文本 | 包含 |
| `starts_with` / `ends_with` | 文本 | |
| `domain_is` | 域名 | 等于该域名**或其子域名**，按点号边界匹配 |
| `regex` | 文本 | JS 正则，见 §7 的限制 |
| `is` | 布尔 | |
| `gt` / `lt` | 数字 | |

- 文本类操作符的 `value` 可以是数组，表示"其中任一"。一条规则就能放一整个关键词表。
- 默认不区分大小写。
- 字段是列表时（`link.domains`、`attachment.name`），任一元素满足即命中。
- **"某个后缀的发件人"请用 `domain_is`**。`ends_with "apple.com"` 会把 `fakeapple.com` 也放进来，编辑器在域名字段上默认给 `domain_is`，选 `ends_with` 时提示这一点。

### 3.5 需要完整正文却拿不到时

`mail_index.body_text` 有长度上限。如果某封邮件 `body_truncated = 1`，而规则组里存在依赖正文的 deny 规则或脱敏规则，则该邮件在链接和用户侧**不显示**，测试器里原因显示为"正文超长，无法完整判定"。宁可少显示，不漏显示。

### 3.6 邮件分类（`category`）

解析时给每封邮件打一个内置分类，存进 `mail_index`，让规则不用自己维护关键词表：

| 值 | 含义 |
| --- | --- |
| `email_change` | 更换 / 确认新邮箱 |
| `password_reset` | 重设、找回、修改密码 |
| `security_change` | 关闭两步验证、恢复账号、删除账号、新增登录方式 |
| `billing` | 账单、收据、订阅变更 |
| `verification` | 提取到验证码或登录链接，且没有命中以上任何一类 |
| `other` | 其余 |

- 判定按表中从上到下的顺序，命中即停。高危类别优先：一封"重设密码的验证码"会被判为 `password_reset`，不是 `verification`。
- 依据是主题与正文里的多语言关键词表（中、英、日起步），放在 `mail-parse` 的数据文件里，随 `parser_version` 版本化。
- 这是启发式的：词表没覆盖的语言或措辞会落到 `verification`。对外分发时不要只靠它，见 `06-scenario-account-resale.md` §3.1 的分档。
- `eq` 的 `value` 可以是数组，表示其中任一。

## 4. B 层：呈现

### 4.1 视图模式

| `view` | 列表 | 详情 |
| --- | --- | --- |
| `full` | 发件人、主题、预览、时间 | 清洗后的 HTML（可切纯文本）、附件按配置 |
| `text` | 同上 | 仅纯文本 |
| `code_only` | 发件人、时间、**验证码或登录链接**（按 `extract`，可复制） | 无详情。没提取到的邮件不显示 |
| `meta_only` | 发件人、主题、时间 | 无详情 |

### 4.2 字段可见性

- `sender`：完整地址 / 只显示域名 / 只显示名称 / 隐藏。
- `recipient`：完整 / 打码（`ab***@icloud.com`）/ 隐藏。对外分发时通常不想暴露完整别名。
- `attachments`：隐藏 / 只列文件名 / 可下载。下载一律 `Content-Disposition: attachment` + `nosniff`。

### 4.3 链接与图片

- `links = strip`：正文里的 URL 替换成"[链接已隐藏]"，HTML 里的 `<a>` 去掉 `href`。
- `links = { allow_domains }`：只保留指向这些域名的链接。
- `remote_images = block`（默认）：阻止远程图片，防追踪像素泄露访问者 IP。

### 4.4 脱敏

按 `redact` 列表依次替换，作用于主题、预览、正文。

**约束：配置了脱敏规则，或 `links` 不是 `keep` 时，`view` 不能是 `full`。** 保存时直接报错并说明原因。HTML 里文字可以被标签切开（`12<b>34</b>`），在 HTML 上做文本替换不可靠，所以这类规则组只能用纯文本或更严格的视图。

### 4.5 HTML 安全（`view = full`）

1. 服务端用 Workers 自带的 `HTMLRewriter` 清洗：删除 `script / iframe / object / embed / form / link / meta / base`，去掉所有 `on*` 属性和 `javascript:` 链接，按配置处理 `img[src]` 与 `a[href]`，给链接加 `rel="noopener noreferrer"`。
2. 前端放进 `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc>`，不给 `allow-scripts`，不给 `allow-same-origin`。
3. `srcdoc` 内注入 CSP：`default-src 'none'; style-src 'unsafe-inline'; img-src data:`（允许远程图片时加 `https:`）。

### 4.6 验证码提取

顺序：temp_email 写在 `metadata.ai_extract` 里的 `auth_code` → 规则组的 `code_regex` → 内置规则（关键词"验证码 / code / OTP / verification"附近的 4–8 位数字或字母数字）。提取是启发式的，可能漏；测试器里会显示每封邮件提取到了什么。

提取细则：先看主题再看正文；接受数字间的空格与连字符（`123 456`、`123-456`，输出时去掉）；接受 4–8 位字母数字混合码；候选必须紧邻关键词，避免把年份、金额、订单号当成验证码。

登录链接（`extract` 含 `login_link` 时）：取正文里第一个域名落在 `links.allow_domains` 内的链接。因此要求 `links` 是非空的 `{ allow_domains }`，否则保存时报错。登录链接等同于一次完整登录，比验证码更敏感，只给确实不发验证码的平台用。

## 5. 求值流水线

```
resolveScope(主体) → { mailboxes[], policy, anchors{created_at, first_access_at} }
  ↓ 时间下界 + 地址 + 游标 → mail-source.listCandidates()      （SQL 下推）
  ↓ mail-index.getOrBuild(ids)                                  （得到 MailFacts）
  ↓ rules.evaluate(policy, facts) → { visible, reason, matched[] }
  ↓ 循环取下一批，直到凑满一页 / 触到 SCAN_CAP / 没有更多
  ↓ render.present(policy.present, mail)                        （列表用索引；详情重新解析原文）
```

- 只有地址、时间、游标下推到 SQL。发件人和内容都在内存里判定：`source` 是信封发件人，对 iCloud 转发邮件不可靠；D1 的 `LIKE` 模式上限 50 字节，正文还可能是 gzip。
- **详情与附件接口每次都重新走完整流水线**（地址归属 + 时间 + 规则），不因为"这个 id 在列表里出现过"就放行。这是防越权读取的关键点。
- 详情渲染基于重新解析的完整原文，并用完整正文再判一次规则；不通过则返回 404。
- 管理员主体没有 policy，直接全量可见、完整呈现。
- 授权的 `rule_group_id` 为空时等价于"黑名单模式、无规则、`view = full`"。

### 失败关闭

| 情况 | 链接 / 用户侧 | 管理员侧 |
| --- | --- | --- |
| 邮件解析失败 | 不显示 | 显示"解析失败"，可看原文 |
| 规则组 JSON 不合 schema 或版本不认识 | 全部不显示，接口返回明确错误码 | 规则组列表标红 |
| 正则编译失败 | 保存时即拒绝；运行时遇到则同上 | 同上 |
| 正文截断且有正文类 deny / 脱敏 | 不显示 | 测试器给出原因 |

## 6. C 层：取件链接的访问约束

存于 `share_links` 的列与 `access` JSON：

| 约束 | 字段 | 说明 |
| --- | --- | --- |
| 状态 | `status` | 生效 / 暂停 / 已撤销 |
| 生效与过期 | `valid_from`、`expires_at` | 绝对时间 |
| 首次访问后过期 | `expire_after_first_access_sec` | 例如首次打开后 30 分钟失效 |
| 访问口令 | `access.password_hash` | 可选 |
| 人机验证 | `access.turnstile` | 需系统已配置 Turnstile |
| 设备数上限 | `access.max_devices` | 每个点过"开始取码"的浏览器记一台，存 `link_visitors`。设为 1 即首个访问者绑定。管理员可重置 |
| 取码方式 | `access.reveal` | `auto`：邮件到了直接显示；`click`：先显示"有新邮件"，点击后才显示内容 |
| 取码次数上限 | `access.max_deliveries_total`、`access.max_deliveries_per_day` | 按**不同邮件**计（存 `link_deliveries`），同一封重复看不重复计；每日按滚动 24 小时。设了上限就必须用 `click`，否则后台轮询会白白消耗次数，保存时校验 |
| 起始时间重置 | `anchor_reset_at` | 换绑收件地址或手动重置时写入，时间下界从这一刻重新算 |
| 给访问者看的信息 | `public_title`、`public_note` | 取件页的标题与说明，纯文本 |
| IP / 国家白名单 | `access.ip_allow`、`access.country_allow` | CIDR 列表；国家取 `request.cf.country` |
| 轮询间隔 | `access.poll_interval_sec` | 不小于 `LINK_POLL_MIN_SEC` |

检查顺序：token 查找 → 状态 → 生效/过期 → IP/国家 → 限流 → 访客 Cookie（没有则要求"开始取码"）→ 设备数 → 取码次数。

**激活与"开始取码"**：所有 `GET` 请求都没有副作用。新访客必须点一次"开始取码"（`POST /start`，口令与人机验证在同一步提交），这一步才登记设备、发访客 Cookie、写入 `first_access_at`。原因：链接被粘贴进聊天软件时，预览机器人会先抓一次页面；如果打开即激活，机器人会占掉设备名额，并让"首次访问后 N 天过期"提前开始计时。

**管理员预览**：后台预览走单独的接口，按该链接的作用域与规则求值并返回逐封 trace，但不登记设备、不计次数、不触发激活。访问者反馈"收不到"时用它看每封邮件为什么没显示。

对外的错误信息只分三种：不存在（404）、已失效（撤销/暂停/过期/次数用尽统一一种说法）、未到生效时间。具体原因写进 `link_access_logs`，管理员在链接详情里看。

Token：32 字节随机数的 base64url，放在路径 `/s/<token>`。页面与接口响应带 `Referrer-Policy: no-referrer`、`Cache-Control: no-store`，公开页不加载任何第三方资源。可"重置 token"让旧链接立即失效。

批量生成：在收件地址列表多选后选规则组与访问约束，默认"一址一链"，可导出 CSV（地址、备注、链接）。

## 7. 校验与上限

| 项 | 上限 |
| --- | --- |
| 每个规则组的规则数 | 30 |
| 每个规则组的条件叶子数 | 60 |
| 条件嵌套深度 | 3 |
| `value` 数组长度 | 200 |
| 正则长度 | 200 字符 |
| 脱敏规则数 | 20 |

正则只有管理员能写，但仍要防误写导致的灾难性回溯：限制长度；被匹配文本本身有 `BODY_INDEX_CAP_BYTES` 上限；保存时编译并在一段固定样本上试跑计时，超阈值则拒绝。

## 8. 规则测试器

规则组编辑页内置。选一个收件地址（或粘贴一个邮件 id），用**当前未保存的配置**对最近 N 封邮件试跑，逐封给出：

- 结果：可见 / 不可见。
- 原因：`deny:<规则名>`、`no_allow_match`、`out_of_window`、`parse_failed`、`body_truncated`、`no_code`。
- 命中的规则与条件。
- 按当前呈现配置渲染出的预览（就是访问者会看到的样子），以及提取到的验证码。

实现上 `rules.evaluate` 本身就返回 trace，测试器只是把它展示出来，没有第二套逻辑。

## 9. 内置模板

初始化时写入三个普通规则组，可改可删：

| 模板 | 要点 |
| --- | --- |
| 仅验证码 | 窗口 10 分钟、`since = subject_created`、`code_only`、收件地址打码、屏蔽含"重设密码 / reset password"等关键词的邮件、最多 5 封 |
| 指定发件人 | 白名单模式，一条待填的 `sender.domain domain_is [...]` 规则，`text` 视图，隐藏链接 |
| 完整访问 | 黑名单模式、无规则、`full` 视图 |

"仅验证码"示例：

```json
{
  "time": { "window_minutes": 10, "since": { "type": "subject_created", "lookback_minutes": 0 } },
  "filter": {
    "mode": "whitelist",
    "rules": [
      { "id": "r1", "name": "含验证码", "enabled": true, "effect": "allow",
        "when": { "field": "code.present", "op": "is", "value": true } },
      { "id": "r2", "name": "屏蔽改密与安全通知", "enabled": true, "effect": "deny",
        "when": { "field": "content", "op": "contains",
                  "value": ["重设密码", "重置密码", "reset your password", "password reset"] } }
    ]
  },
  "present": {
    "view": "code_only", "sender": "domain", "recipient": "masked", "snippet": false,
    "links": "strip", "remote_images": "block", "attachments": "hidden", "redact": [], "extract": ["code"]
  },
  "limits": { "max_mails": 5 }
}
```

**安全提醒（会写进编辑器的说明里）**：把收件地址分享出去，等于对方可能收到这个地址的密码重置邮件。对外分发的规则组建议至少满足其一：`code_only` 视图；白名单限定发件人；deny 改密类关键词并隐藏链接。

卖号取码场景有专门的模板、平台预设与边界情况清单，见 `06-scenario-account-resale.md`；上面这个示例只用来说明配置结构。

## 10. 测试要点

`rules` 是纯函数，用表驱动单测覆盖：

- 三步求值的全部分支；白名单无 allow 规则；黑名单里放 allow 被拒。
- `domain_is` 的边界：`apple.com` / `id.apple.com` 命中，`fakeapple.com` / `apple.com.evil.io` 不命中。
- 归一化：全角字符、零宽字符、大小写、多余空白。
- 纯文本与 HTML 内容不一致时 deny 仍命中。
- 时间下界的各种组合，`first_access` 无锚点的情况。
- 详情接口对"不在作用域内的 mail id"返回 404。
- `mail_index` 在 `message_id` / `received_at` 不一致时重建。
- iCloud HME 样本：`From` 与 `s=` 都进入发件人候选；`p=` 与收件地址不符时不采用 `s=`。
- 分类：重设密码的验证码判为 `password_reset`；每种语言各有样本。
- `GET` 无副作用：没点"开始取码"前不登记设备、不写 `first_access_at`。
- 取码计数按不同邮件去重；设了上限却用 `auto` 时保存失败。
- 换绑并重置起始时间后，看不到新地址上换绑之前的邮件。
