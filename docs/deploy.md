# 部署

本文是把 MailLink 部署到 Cloudflare Workers 的操作手册。本仓库的开发流程不执行任何远程命令，下面的命令都由部署者在自己的账号下手动执行。命令默认在仓库根目录运行，`wrangler` 用仓库里的版本（`pnpm --filter worker exec wrangler …`，下文简写为 `wrangler …`，在 `apps/worker/` 目录执行）。

配置的含义见 `docs/design/01-architecture-and-data.md` §2；配置文件是 `apps/worker/wrangler.jsonc`。

## 1. 前提

- **Workers Paid 套餐**。设计按 Paid 的 CPU 时间与子请求上限来做（PBKDF2、HTML 清洗、按需解析邮件都按 Paid 计算），Free 套餐会在登录或解析邮件时超时。生产 WebCrypto 对 PBKDF2 迭代数的上限没有可靠文档、本地也测不出来，**以生产上的初始化为准**（§6 第一项）。
- **与 cloudflare_temp_email 在同一个 Cloudflare 账号**。MailLink 直接绑定 temp_email 的 D1 数据库读取邮件，D1 绑定不能跨账号。
- 本地已能通过 `pnpm install`、`pnpm typecheck`、`pnpm test`、`pnpm --filter web build`。
- `wrangler login` 登录到目标账号（只在部署者自己的机器上做）。

## 2. 数据库

### 2.1 APP_DB（MailLink 自己的库）

```sh
wrangler d1 create mail-link
```

新版 wrangler 建库后会询问是否替你把绑定写进配置文件（"add it on your behalf" 一类的提示），**回答否**：`wrangler.jsonc` 里已经有 `APP_DB` 那一项，让它代写会再追加一条重复的 D1 绑定。

把输出的 `database_id` 手动填进 `wrangler.jsonc` 里 `binding: "APP_DB"` 那一项，`migrations_dir` 保持 `"migrations"`（MAIL_DB 那一项的 `migrations_dir` 也保持原样，见 §2.2）。填完确认 `d1_databases` 里只有 `APP_DB`、`MAIL_DB` 两项。

### 2.2 MAIL_DB（temp_email 的库，只读）

在 Cloudflare 控制台或 `wrangler d1 list` 找到 temp_email 正在用的 D1，把它的 `database_name` 与 `database_id` 填进 `binding: "MAIL_DB"` 那一项。

- **不配置不等于受保护**：wrangler 在 D1 绑定没有 `migrations_dir` 时默认用 `./migrations`，也就是本项目 APP_DB 的迁移。误敲 `wrangler d1 migrations apply MAIL_DB --remote` 会把本项目的建表语句执行到 temp_email 的库里。所以 `wrangler.jsonc` 给 MAIL_DB 显式配置了 `"migrations_dir": "mail-db-no-migrations"`，这个目录必须保持为空（只有一个说明文件，`apps/worker/test/mail-db-migrations-guard.test.ts` 检查里面没有 `.sql`，且 MAIL_DB 确实指向它）。这是防误操作，不是迁移 MAIL_DB。
- **迁移命令只写 `APP_DB`**，不要对 MAIL_DB 执行任何 `wrangler d1 migrations` 或 `wrangler d1 execute` 写语句。MailLink 的代码只读它（`apps/worker/src/mail-source/` 是唯一接触它的目录，有单测禁止写入类 SQL），但 D1 没有只读绑定，误操作会直接改坏 temp_email 的数据。`apps/worker/package.json` 的 `db:migrate` 也只针对 `APP_DB`（且只在本地）。
- **误对 MAIL_DB 执行了 `migrations list/apply` 时**（已用 wrangler 4.165 在本地库核实）：因为目录为空，输出 `No migrations to apply!`，不会执行任何建表语句；但 wrangler 仍会在该库里建一张空的 `d1_migrations` 记录表（`list` 也会建）。temp_email 自己不用这张表，可以先确认它是空的再删除：

  ```sh
  wrangler d1 execute MAIL_DB --remote --command "SELECT COUNT(*) AS n FROM d1_migrations"   # 应为 0
  wrangler d1 execute MAIL_DB --remote --command "DROP TABLE d1_migrations"
  ```

  这是唯一一处允许对 MAIL_DB 执行的写语句，只用于撤销误操作；计数不是 0 时不要删，先查明是谁写的。
- temp_email 升级后，部署后的健康检查会重新探测表结构（见 §6）。
- **`to_address` 迁移之前的旧邮件按别名查不到**：`raw_mails.to_address`（真实收件人，iCloud 隐私邮箱别名就记在这里）是 temp_email 的迁移 `db/2026-08-02-to-address.sql` 加的列（CHANGELOG v1.15.0；fork 独有，不改 `DB_VERSION`，仍是 `v0.0.11`）。这次迁移只加列和索引、不回填，执行之前收到的邮件 `to_address` 为空，MailLink 只能按 `address`（信封收件人，即转发链最后一跳的 temp_email 邮箱）匹配它们，所以以 iCloud 别名作为收件地址时看不到这些旧邮件，管理员"全部邮件"里不带地址筛选仍能看到。没有执行该迁移时健康检查会报缺列警告（见 §6）。

### 2.3 远程迁移（只针对 APP_DB）

```sh
wrangler d1 migrations list APP_DB --remote    # 先看待执行的迁移
wrangler d1 migrations apply APP_DB --remote
```

迁移只会加表、加列、加索引；每次升级代码前先执行迁移，再部署 Worker。

## 3. 变量与密钥

### 3.1 `PUBLIC_ORIGIN`

在 `wrangler.jsonc` 的 `vars.PUBLIC_ORIGIN` 填对外访问地址，例如 `https://mail.example.com`（协议 + 主机名，不带路径与结尾斜杠）。本地开发不改这里，在 `apps/worker/.dev.vars` 里写 `PUBLIC_ORIGIN=http://localhost:<端口>` 覆盖（见根 README）。它是以下几项的唯一来源：

- 写操作的 CSRF 校验（浏览器 `Origin` 必须与它完全一致）；
- 通行密钥的 RP ID 与 origin；
- OAuth 回调地址；
- Turnstile 校验时比对的主机名。

同时在 `wrangler.jsonc` 里配置该域名的路由（自定义域名），例如：

```jsonc
"routes": [{ "pattern": "mail.example.com", "custom_domain": true }],
"workers_dev": false,
"preview_urls": false
```

建议同时关掉 `*.workers.dev` 子域名与预览地址（上面两行）：它们的主机名与 `PUBLIC_ORIGIN` 不一致，在那里写操作会被 CSRF 校验拒绝、通行密钥与 Turnstile 也用不了，留着只会多一个入口。仓库里的 `wrangler.jsonc` 没写这两项，是为了不影响本地 `wrangler dev`，部署时自行加上。

**更换域名会让所有已注册的通行密钥失效**（RP ID 变了），OAuth 提供方的回调地址与 Turnstile 控件的主机名也要同步修改。上线前定好域名。

### 3.2 secrets

Worker 还没部署过时，第一次 `wrangler secret put` 会先建一个空的草稿 Worker 来挂 secret，属于正常现象，之后 `wrangler deploy` 会覆盖它。

```sh
openssl rand -base64 48 # 先存进密码管理器（永远不能换，丢了无法找回），再粘贴给下一条命令
wrangler secret put APP_SECRET
openssl rand -hex 24    # 同样先记下，初始化时还要用
wrangler secret put SETUP_TOKEN
```

不要用管道把 `openssl` 的输出直接交给 `secret put`：那样谁也看不到、也没法备份这个主密钥。

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
- **关掉会改写 HTML 的 zone 功能**：自定义域名所在 zone 的 Rocket Loader、Web Analytics 的自动注入（"Automatic setup"/JS snippet 注入）、Email Address Obfuscation 等会往页面里插脚本或改写 `<script>`。页面 CSP 只放行构建时算好哈希的内联脚本与 Turnstile，插进来的脚本会被拦截（控制台出现 CSP 报错），Rocket Loader 还会让页面自己的脚本跑不起来。在控制台 → 该域名 → Speed / Analytics / Scrape Shield 里关掉，或用 Configuration Rules 只对 MailLink 的主机名关闭。

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
- [ ] **限流已配置**：同一接口返回里 `rate_limit.configured` 与 `rate_limit.link_configured` 都为 `true`。用错误密码连续登录多次（阈值 10 次 / 60 秒，按 IP 与用户名分别计数，边缘计数有延迟），之后应出现 429 并带 `Retry-After`：

  ```sh
  B=https://mail.example.com
  for i in $(seq 1 15); do
    curl -s -o /dev/null -w "%{http_code} " -H "Origin: $B" -H "X-MailLink-Csrf: 1" -H "Content-Type: application/json" \
      -X POST $B/api/auth/login -d '{"username":"smoke-test-nobody","password":"wrong-password-123"}'
  done; echo   # 先是一串 401，之后变成 429
  ```
- [ ] **cron 已触发**：等过 5 分钟后再看健康检查的 `cron.prewarm`，应有上次运行时间且没有错误；每日清理（UTC 03:17）次日看 `cron.cleanup`。控制台 Worker → Settings → Triggers 里应能看到两条 cron。
- [ ] **页面安全头**：

  ```sh
  curl -sI https://mail.example.com/ | grep -iE 'content-security|referrer|x-content-type|permissions|x-frame'
  curl -sI https://mail.example.com/s/test | grep -iE 'content-security|referrer|cache-control|x-robots'
  curl -sI https://mail.example.com/api/public/config | grep -iE 'referrer|x-content-type'
  ```

  首页与 `/s/*` 都应带 CSP（含 `frame-ancestors 'none'`）、`Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`；`/s/*` 另有 `Cache-Control: no-store` 与 `X-Robots-Tag: noindex, nofollow`；API 响应带 `nosniff` 与 `no-referrer`。
- [ ] **浏览器里看一眼**：打开一封 HTML 邮件的详情与一个开启了人机验证的取件链接，开发者工具控制台不应有 `Content-Security-Policy` 报错（`postMessage … target origin` 一类是 Turnstile 自身的提示，可忽略）。有 CSP 报错且来源是 `cloudflareinsights`、`rocket-loader`、`email-decode` 一类脚本时，按 §4 关掉对应的 zone 功能。
- [ ] **真实邮件能解析**：在"全部邮件"里各打开一封
  - temp_email 以 gzip 存储的真实邮件（`raw_blob` 有值、`raw` 为空的那类），正文与验证码正常显示，不是"解析失败"；
  - 经 iCloud 隐私邮箱转发的真实邮件：收件地址是别名本身，发件人候选里有原平台的域名（规则白名单靠它，见 06 §4）。顺手用"以此邮件创建规则"生成该平台的规则草稿，在测试器里确认判为可见。
- [ ] **手机走一遍真实取件链接**：用手机（建议走移动网络，不连办公室 Wi-Fi）打开一个真实取件链接，点"开始取码"，在登录页触发一次验证码并在取件页取到。回到后台该链接详情的"访问日志"，应能看到这次访问的 IP 与国家（国家为空说明请求没有经过 Cloudflare 边缘，检查域名是否走了代理）。
- [ ] **正式域名上登记通行密钥**：在 `PUBLIC_ORIGIN` 的域名上为管理员登记一把通行密钥，退出后用它登录一次。通行密钥绑定 RP ID，本地或其他域名登记的不能用（§3.1）。
- [ ] **初始化入口已关闭**：`GET /api/setup/status` 返回 `{"needs_setup":false}`，`POST /api/setup` 返回 404；`wrangler secret list` 的输出里不再有 `SETUP_TOKEN`（§3.2）。

  ```sh
  B=https://mail.example.com
  curl -s $B/api/setup/status; echo                                     # {"needs_setup":false}
  curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: $B" -H "X-MailLink-Csrf: 1" -H "Content-Type: application/json" \
    -X POST $B/api/setup -d '{}'                                         # 404
  wrangler secret list                                                   # 不应再有 SETUP_TOKEN
  ```
- [ ] **`workers.dev` 与预览地址已关**：`wrangler.jsonc` 里有 `"workers_dev": false` 与 `"preview_urls": false`（§3.1），控制台 Worker → Settings → Domains & Routes 里两项都显示停用；访问 `https://mail-link.<你的子域>.workers.dev/` 不再返回本站页面。

## 7. Turnstile（人机验证）

1. 在 Cloudflare 控制台 → Turnstile 新建控件，**主机名**填 `PUBLIC_ORIGIN` 的主机名（如 `mail.example.com`）。服务端校验时会比对 siteverify 返回的 `hostname` 与 `PUBLIC_ORIGIN` 主机名，不一致即拒绝。
2. 在 MailLink "系统设置 → 人机验证"里填 site key 与 secret（secret 加密存在 APP_DB，读取接口只回"已设置"），勾选作用范围：登录、注册、取件页。启用时三项都要齐。
3. 取件页只有在链接自己开启了"人机验证"时才校验，系统设置的取件页范围只决定"是否允许链接开启"。已登记的设备再次取码不再要求验证。
4. 页面 CSP 已放行 `https://challenges.cloudflare.com`（`script-src` 与 `frame-src`）。这是取件页"不加载第三方资源"的唯一例外，只在需要时按需加载。
5. **建议上线即对"登录"启用 Turnstile**，或在 Cloudflare 控制台 → 该域名 → Security → WAF → Rate limiting rules 加一条规则（例如匹配 `http.request.method eq "POST" and http.request.uri.path eq "/api/auth/login"`，按 IP 计数，超过阈值就 Block 或 Managed Challenge）。原因：每次密码登录失败都会写一行审计（`audit_logs`，动作 `auth.login_failed`）；应用内限流按 IP 与用户名分别计数（§3.3），换着 IP 与用户名刷就绕得过去，审计表会快速增长。审计默认保留 `AUDIT_LOG_RETENTION_DAYS_DEFAULT` = 365 天（"系统设置 → 日志"可改），每日清理每张表最多删 `CLEANUP_DELETE_BATCH_SIZE × CLEANUP_MAX_BATCHES` = 1000 × 50 = 5 万行（`apps/worker/src/constants.ts`），而且只删超过保留期的行，挡不住短期刷量。

### 7.1 Turnstile 配错导致无法密码登录时的自救

登录范围用了错误的 secret（或 site key 与 secret 不是同一个控件、控件主机名没填对）时，**所有密码登录都会失败**：登录接口返回 400 `turnstile_failed`（"人机验证未通过"），`wrangler tail` 里能看到 `Turnstile 校验未通过` 与 siteverify 的 `error-codes`（如 `invalid-input-secret`）。注册与开启了人机验证的取件链接同样受影响。

1. **先试不经过 Turnstile 的登录方式**：通行密钥登录与 OAuth 登录不做人机验证。能登进去就直接在"系统设置 → 人机验证"里改正 secret 或取消"登录"范围，不用动数据库。
2. **都不行时改 APP_DB**（只针对 APP_DB）。Turnstile 设置存在 `settings` 表，每个键一行、`value` 是 JSON 文本：`turnstile.enabled`（`true`/`false`）、`turnstile.scopes`（如 `["login","register","pickup"]`）、`turnstile.site_key`、`turnstile.secret_enc`（密文）。没有缓存，改完下一次请求即生效。执行前先备份并确认当前值：

   ```sh
   wrangler d1 time-travel info APP_DB                                   # 记下当前书签，出错时可恢复（§10）
   wrangler d1 export APP_DB --remote --table settings --output=settings-before-turnstile-fix.sql
   wrangler d1 execute APP_DB --remote --command "SELECT key, value FROM settings WHERE key IN ('turnstile.enabled', 'turnstile.scopes')"
   ```

   推荐只从作用范围里去掉 `login`（取件页的人机验证不受影响）：

   ```sh
   wrangler d1 execute APP_DB --remote --command "UPDATE settings SET value = (SELECT json_group_array(s.value) FROM json_each(settings.value) AS s WHERE s.value <> 'login'), updated_at = unixepoch() WHERE key = 'turnstile.scopes'"
   wrangler d1 execute APP_DB --remote --command "SELECT key, value FROM settings WHERE key = 'turnstile.scopes'"   # 确认已没有 login
   ```

   若上面的 `SELECT` 里没有 `turnstile.scopes` 这一行（从未保存过作用范围，用的是默认的三项全开），`UPDATE` 不会生效，改为整体关闭：

   ```sh
   wrangler d1 execute APP_DB --remote --command "UPDATE settings SET value = 'false', updated_at = unixepoch() WHERE key = 'turnstile.enabled'"
   ```

   整体关闭后，开启了"人机验证"的取件链接在"开始取码"时会返回 503 `turnstile_not_configured`（失败关闭，不会放行），修好配置后自动恢复。**不要删除 `turnstile.scopes` 这一行**：删掉等于回到默认的三项全开。
3. 登录后在"系统设置 → 人机验证"里填对 secret，用一个无痕窗口确认能登录，再把"登录"范围勾回来。

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

- **PBKDF2 迭代数**：本地无法验证生产上限，以生产上的初始化为准，见 §6 第一项。
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
- **L2 的邮件分类靠关键词，有边界**（02 §3.6，词表在 `apps/worker/src/mail-parse/data/category-keywords.ts`，覆盖中、英、日、法、德、西、葡、意、韩、俄）。模板 A 这类"发件人域名 + `category = verification`"的规则组只能拦住词表认得的说法：
  - 词表没覆盖的语言，或平台用了没收录的措辞，高危邮件（改密码、换邮箱、加手机号、改两步验证……）会落到 `verification`，验证码照样交给买家；
  - 只写"Your verification code is 123456"、不说明用途的邮件，规则分不出它是登录还是敏感操作（06 §10）；
  - 为了不把普通登录码误判，"If this wasn't you, change your password"这类登录邮件页脚常见的祈使句不算高危；以"If you didn't request this / If this wasn't you / 如非本人操作"等开头的条件句（只认中、英），紧跟逗号、以 reset / change / update / secure（修改 / 重置 / 更改 / 重设）开头、不超过 80 字符的那一个建议分句（如"…, you can reset your password"）也不参与判定，分句在逗号、分号、冒号、破折号或句末处结束。因此高危用途只写在这两种句式里的邮件会漏掉（例如"If this wasn't you, update your recovery email"）；反过来，登录邮件里若写了"to set up two-factor authentication""to change your password""update your payment method"之类的说法会被当成高危藏起来（买家会来问，用后台预览查原因）。

  **共享号、高价值号请用 L3**：在 L2 的 allow 条件里再加"主题匹配已知的登录验证码主题"（06 §3.1），主题模式用"全部邮件 → 以此邮件创建规则"从真实登录邮件生成，主题不是已知登录邮件的一律不显示。上线前每个平台都拿真实的登录、改密码、换邮箱邮件在测试器里跑一遍。
- **内置验证码提取只认中、英、日的关键词**（`code-keywords.ts`）：法、德、西、葡、意、韩、俄等语言的验证码只有 temp_email 开了 AI 提取（`metadata.ai_extract`）或规则组配了 `code_regex` 时才提取得到，否则 `code_only` 视图里不显示这封邮件（失败关闭，买家拿不到码会来问）。
- **发件人不做 SPF / DKIM / DMARC 校验**：`sender.domain` 取自 `From` 头与 iCloud 的 `X-ICLOUD-HME`，MailLink 不核对它们是否经过发件域的认证，`From` 头可以任意伪造。白名单只能挡住"别的平台的邮件"，挡不住有人冒充平台发信到别名；按认证结果判定（`auth.spf / dkim / dmarc` 字段）在设计里属于二期（02 §3.3）。
