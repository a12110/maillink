# 部署

本文是把 MailLink 部署到 Cloudflare Workers 的操作手册。本仓库的开发流程不执行任何远程命令，下面的命令都由部署者在自己的账号下手动执行。命令默认在仓库根目录运行，`wrangler` 用仓库里的版本（`pnpm --filter worker exec wrangler …`，下文简写为 `wrangler …`，在 `apps/worker/` 目录执行）。

配置的含义见 `docs/design/01-architecture-and-data.md` §2；配置文件是 `apps/worker/wrangler.jsonc`。

## 1. 前提

- **Workers Paid 套餐**。设计按 Paid 的 CPU 时间与子请求上限来做（PBKDF2、HTML 清洗、按需解析邮件都按 Paid 计算），Free 套餐会在登录或解析邮件时超时。
- **与 cloudflare_temp_email 在同一个 Cloudflare 账号**。MailLink 直接绑定 temp_email 的 D1 数据库读取邮件，D1 绑定不能跨账号。
- 本地已能通过 `pnpm install`、`pnpm typecheck`、`pnpm test`、`pnpm --filter web build`。
- `wrangler login` 登录到目标账号（只在部署者自己的机器上做）。

## 2. 数据库

### 2.1 APP_DB（MailLink 自己的库）

```sh
wrangler d1 create mail-link
```

把输出的 `database_id` 填进 `wrangler.jsonc` 里 `binding: "APP_DB"` 那一项，`migrations_dir` 保持 `"migrations"`。

### 2.2 MAIL_DB（temp_email 的库，只读）

在 Cloudflare 控制台或 `wrangler d1 list` 找到 temp_email 正在用的 D1，把它的 `database_name` 与 `database_id` 填进 `binding: "MAIL_DB"` 那一项。

- **永远不要给 MAIL_DB 配 `migrations_dir`**，也不要对它执行任何 `wrangler d1 migrations` 或 `wrangler d1 execute` 写语句。MailLink 的代码只读它（`apps/worker/src/mail-source/` 是唯一接触它的目录，有单测禁止写入类 SQL），但 D1 没有只读绑定，误操作会直接改坏 temp_email 的数据。
- temp_email 升级后，部署后的健康检查会重新探测表结构（见 §7）。

### 2.3 远程迁移（只针对 APP_DB）

```sh
wrangler d1 migrations list APP_DB --remote    # 先看待执行的迁移
wrangler d1 migrations apply APP_DB --remote
```

迁移只会加表、加列、加索引；每次升级代码前先执行迁移，再部署 Worker。

## 3. 变量与密钥

### 3.1 `PUBLIC_ORIGIN`

在 `wrangler.jsonc` 的 `vars.PUBLIC_ORIGIN` 填对外访问地址，例如 `https://mail.example.com`（协议 + 主机名，不带路径与结尾斜杠）。它是以下几项的唯一来源：

- 写操作的 CSRF 校验（浏览器 `Origin` 必须与它完全一致）；
- 通行密钥的 RP ID 与 origin；
- OAuth 回调地址；
- Turnstile 校验时比对的主机名。

同时在 `wrangler.jsonc` 里配置该域名的路由（自定义域名），例如：

```jsonc
"routes": [{ "pattern": "mail.example.com", "custom_domain": true }]
```

**更换域名会让所有已注册的通行密钥失效**（RP ID 变了），OAuth 提供方的回调地址与 Turnstile 控件的主机名也要同步修改。上线前定好域名。

### 3.2 secrets

```sh
openssl rand -base64 48 | wrangler secret put APP_SECRET
openssl rand -hex 24    # 记下输出，下一条命令粘贴进去，初始化时还要用
wrangler secret put SETUP_TOKEN
```

- `APP_SECRET`：主密钥，至少 32 字符。由它派生密码 pepper、TOTP 密钥加密、OAuth client secret 与 Turnstile secret 加密、链接 token 加密、各类签名 Cookie。**部署后不要更换**：换了以后所有密码都无法验证、已加密的 TOTP 与第三方密钥全部无法解密、取件链接 token 无法再导出。必须轮换时等同重建站点。另找安全的地方保存一份。
- `SETUP_TOKEN`：只在首次初始化创建管理员时校验，初始化完成后可以删除（`wrangler secret delete SETUP_TOKEN`）。
- 不要把真实值写进 `wrangler.jsonc` 或任何仓库文件；本地开发用 `apps/worker/.dev.vars`（已忽略）。

### 3.3 限流 binding

`wrangler.jsonc` 的 `ratelimits` 有两个 binding：

| binding | 用途 | 阈值 |
| --- | --- | --- |
| `RATE_LIMITER` | 登录、初始化、注册、2FA 与通行密钥等再确认类接口 | 10 次 / 60 秒 |
| `LINK_RATE_LIMITER` | 取件链接公开接口（含轮询） | 120 次 / 60 秒 |

仓库里的 `namespace_id`（`1001`、`1002`）是占位值。它是**账号内唯一**的正整数字符串，部署前改成本账号里其他 Worker 没用过的两个数（temp_email 若也用了 Rate Limiting，要避开它的 namespace）。`limit` / `period` 须与 `apps/worker/src/constants.ts` 的 `RATE_LIMITER_SETTINGS` 一致。缺少 binding 时受保护接口返回 503 `rate_limiter_not_configured`，不会放行。

## 4. 构建与部署

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter web build          # 产物在 apps/web/dist，末尾自动生成 dist/_headers
cd apps/worker
wrangler d1 migrations apply APP_DB --remote
wrangler deploy
```

- `pnpm --filter web build` 的最后一步 `scripts/gen-headers.mjs` 读取 `dist/index.html`，计算每段内联脚本的 `sha256`，生成页面安全头文件 `dist/_headers`（CSP、`Referrer-Policy`、`X-Content-Type-Options`、`Permissions-Policy` 等；`/s/*` 另加 `Cache-Control: no-store` 与 `X-Robots-Tag`）。**不要手改 `dist/`**，改了 `index.html` 就重新构建。
- 页面由 Workers Static Assets 直出，`_headers` 只作用于页面与静态资源；`/api/*` 由 Worker 处理，安全头在代码里统一加。
- `wrangler deploy` 会同时上传 `apps/web/dist` 作为静态资源。

## 5. 首次初始化

1. 打开 `https://<域名>/setup`，填管理员用户名、密码（至少 10 个字符）与 `SETUP_TOKEN`。也可以用 API：

   ```sh
   B=https://mail.example.com
   curl -s $B/api/setup/status
   curl -s -H "Origin: $B" -H "X-MailLink-Csrf: 1" -H "Content-Type: application/json" \
     -X POST $B/api/setup -d '{"username":"admin","password":"<密码>","setup_token":"<SETUP_TOKEN>"}'
   ```

2. 初始化成功后 `/api/setup` 返回 404，再删除 `SETUP_TOKEN`（见 §3.2）。
3. 登录后在"账号安全"启用两步验证，建议同时登记一把通行密钥；需要时在"系统设置 → 安全"开启"管理员必须启用两步验证"（规则见 §9）。

## 6. 部署后冒烟检查

逐项确认，任何一项不通过都先排查再开放使用。

- [ ] **PBKDF2 在生产可用**：初始化（§5，创建管理员时计算一次哈希）成功，并用管理员账号登录一次。密码哈希用 PBKDF2-SHA256 10 万次迭代（`apps/worker/src/constants.ts` 的 `PBKDF2_ITERATIONS`），本地 workerd 不执行生产的迭代数上限，生产上的初始化与首次登录是唯一的验证。若返回 500 且日志（`wrangler tail`）里是 WebCrypto 的 `NotSupportedError`，说明生产上限更低：调低该常量、重新部署后再初始化（此时库里还没有可用的哈希）。
- [ ] **健康检查**：`GET /api/admin/system/health`（管理员会话）返回 200，`mail_db.probe.healthy` 为 `true`、`missing_required` 为空、`db_version` 是 temp_email 的版本号（如 `v0.0.11`）；`warnings` 有内容时按提示核对。MAIL_DB 不健康时该接口返回 503，邮件相关接口一律 503（失败关闭）。
- [ ] **限流已配置**：同一接口返回里 `rate_limit.configured` 与 `rate_limit.link_configured` 都为 `true`。连续 11 次错误登录，第 11 次应为 429 并带 `Retry-After`。
- [ ] **cron 已触发**：等过 5 分钟后再看健康检查的 `cron.prewarm`，应有上次运行时间且没有错误；每日清理（UTC 03:17）次日看 `cron.cleanup`。控制台 Worker → Settings → Triggers 里应能看到两条 cron。
- [ ] **页面安全头**：

  ```sh
  curl -sI https://mail.example.com/ | grep -iE 'content-security|referrer|x-content-type|permissions|x-frame'
  curl -sI https://mail.example.com/s/test | grep -iE 'content-security|referrer|cache-control|x-robots'
  curl -sI https://mail.example.com/api/public/config | grep -iE 'referrer|x-content-type'
  ```

  首页与 `/s/*` 都应带 CSP（含 `frame-ancestors 'none'`）、`Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`；`/s/*` 另有 `Cache-Control: no-store` 与 `X-Robots-Tag: noindex, nofollow`；API 响应带 `nosniff` 与 `no-referrer`。
- [ ] **浏览器里看一眼**：打开一封 HTML 邮件的详情与一个开启了人机验证的取件链接，开发者工具控制台不应有 `Content-Security-Policy` 报错（`postMessage … target origin` 一类是 Turnstile 自身的提示，可忽略）。

## 7. Turnstile（人机验证）

1. 在 Cloudflare 控制台 → Turnstile 新建控件，**主机名**填 `PUBLIC_ORIGIN` 的主机名（如 `mail.example.com`）。服务端校验时会比对 siteverify 返回的 `hostname` 与 `PUBLIC_ORIGIN` 主机名，不一致即拒绝。
2. 在 MailLink "系统设置 → 人机验证"里填 site key 与 secret（secret 加密存在 APP_DB，读取接口只回"已设置"），勾选作用范围：登录、注册、取件页。启用时三项都要齐。
3. 控件的 `action` 必须等于作用范围：`login` / `register` / `pickup`，服务端会核对。
4. 取件页只有在链接自己开启了"人机验证"时才校验，系统设置的取件页范围只决定"是否允许链接开启"。已登记的设备再次取码不再要求验证。
5. 页面 CSP 已放行 `https://challenges.cloudflare.com`（`script-src` 与 `frame-src`）。这是取件页"不加载第三方资源"的唯一例外，只在需要时按需加载。

## 8. OAuth 提供方

- 回调地址固定为 `${PUBLIC_ORIGIN}/api/auth/oauth/<slug>/callback`，在提供方后台登记这个地址（系统设置里新建提供方后界面会给出供复制）。
- 提供方的端点只允许 `https` 与 443 端口。
- 更换 `PUBLIC_ORIGIN` 后要在每个提供方后台改回调地址。
- 默认 OAuth 登录后不再要求本地 2FA（可在"注册与登录"里开启"OAuth 登录后仍需两步验证"）。

## 9. 管理员强制两步验证

开启"系统设置 → 安全 → 管理员必须启用两步验证"后：

- 管理员访问 `/api/admin/*` 时，**会话本身**必须是多因素登录的：会话的登录方式含 `totp`、`recovery`（密码或 OAuth + 第二步）或 `passkey`（通行密钥登录）。账号启用了 TOTP、但这次只用 OAuth 单因素登录的会话会被挡（403 `admin_2fa_required`）。
- 开启后，已启用 TOTP 的管理员走 OAuth 登录也会进入第二步验证。
- 在账号安全页启用 TOTP 时当前会话立即视为已完成两步验证；关闭 TOTP 后当前会话立即失去资格。
- 防锁死：只有存在至少一个启用的管理员能产生合格会话时才允许开启（已启用 TOTP 且能用开放的密码或 OAuth 完成第一步，或登记了通行密钥且通行密钥登录开放）；之后修改"允许的登录方式"也会做同样的检查。

## 10. 备份与回滚

- **APP_DB 备份**：D1 自带 Time Travel（Paid 套餐保留 30 天），可按时间点恢复：

  ```sh
  wrangler d1 time-travel info APP_DB
  wrangler d1 time-travel restore APP_DB --timestamp=<RFC3339 或 Unix 时间>
  ```

  另可定期导出一份 SQL：`wrangler d1 export APP_DB --remote --output=mail-link-<日期>.sql`。导出与恢复期间库会被锁，选低峰期。
- **MAIL_DB 不归本项目备份或恢复**，它是 temp_email 的库，按 temp_email 的方式处理；绝不要对它执行 restore。
- **Worker 回滚**：`wrangler deployments list` 查看历史版本，`wrangler rollback [<version-id>]` 回到上一版。迁移只进不退：回滚代码前确认旧代码能在已迁移的库上运行（目前的迁移都是加表、加列、加索引，旧代码不受影响）；需要撤销某次迁移的数据变化时用 Time Travel 恢复到迁移前的时间点。
- `APP_SECRET` 与 `SETUP_TOKEN` 不在数据库里，自行妥善保存。

## 11. 已知限制（运维相关）

- **PBKDF2 迭代数**：见 §6 第一项，生产首次登录前无法本地验证。
- **限流粒度**：Workers Rate Limiting 的 simple binding 不能只数失败请求。任何人从多个 IP 每分钟发 10 次即可让某个用户名暂时登录不了；NAT 后的多个用户共用 IP 维度的配额。按用户的第二因素失败上限（15 分钟 10 次，锁 15 分钟）在应用层实现，知道密码的人可以故意输错锁住某用户的 2FA 15 分钟（有审计）。
- **限流 namespace_id** 是占位值，见 §3.3。
- **cron 清理有单次上限**：日志每张表每次最多删 5 万行、孤儿索引每次最多扫 1 万行，超出时留到下一天；`last_run` 不会标出"本次被截断"。
- **本地触发 cron** 用 `/cdn-cgi/handler/scheduled?cron=…`（`/__scheduled` 会被 SPA 兜底截走），只在本地 `wrangler dev` 有意义。
- **OAuth 出站请求**无法防 DNS rebinding（Workers 拿不到 DNS 解析结果），只校验主机名形态与端口；只配置可信的提供方。
- **防锁死检查范围**：保存"安全"与"注册与登录"设置时检查；停用 OAuth 提供方、管理员清除自己或别人的凭据时不做这项检查。真被锁在管理端外时，用另一位管理员处理，或在 APP_DB 里把 `security.admin_require_2fa` 设回 `false`（`wrangler d1 execute APP_DB --remote --command "DELETE FROM settings WHERE key = 'security.admin_require_2fa'"`，只针对 APP_DB）。
- **设了 `max_mails` 的规则组**：详情与附件每次多扫一遍首页（最坏约 40–45 次 D1 查询），Paid 下可接受。
- **授权列表里的授权数**统计全部授权（含已失效的），界面标"含失效"。
- **前端主包体积**超过 500 kB，暂未做路由懒加载，首屏在慢网络上稍慢。
- **iCloud HME 转发**的发件人展示仍待真实样本确认。
- **Safari 本地开发**：`Secure` Cookie 在 `http://localhost` 下不保存，本地联调用 Chrome；生产是 https，不受影响。
- **Turnstile 域名**：若 Cloudflare 将来更换 Turnstile 的脚本或 iframe 域名，需同步修改 `apps/web/scripts/gen-headers.mjs` 里的 CSP 并重新构建。
