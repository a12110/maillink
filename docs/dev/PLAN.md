# 开发台账

由主 agent（claude-opus-5-5）维护。主 agent 只做调度与验收，具体实现由子 agent 完成。

## 模型分工

| 角色 | 模型 |
| --- | --- |
| 主 agent：调度、复跑验证命令、提交 | `txapi-copy/claude-opus-5-5` |
| 子 agent：常规实现任务 | `txapi-copy/claude-sonnet-5-5` |
| 子 agent：复杂任务，或 sonnet 结果不达标时重做 | `txapi-copy/claude-opus-5-5` |
| 里程碑验收评审（默认） | `txapi-copy/claude-opus-5-5` |
| 最终整体验收 | `txapi-copy/claude-fable-5-2` |

思考强度按任务难度选 variant（写法 `provider/model#variant`）：脚手架、增删改查类用 `medium`/`high`；规则引擎、认证（TOTP/Passkey/OAuth）、安全加固用 `xhigh`；里程碑验收用 `high`；最终整体验收用 `xhigh`。

## 并发规则

必要时可以多个子 agent 并发执行，前提是任务之间没有依赖、改动的文件不重叠。

- **适合并发**：后端里程碑与前端 UI；互不依赖的两个后端模块；上一个里程碑的验收评审与下一个里程碑的实现。
- **不并发**：后一个任务要用前一个任务的接口或表结构时，等前一个验收通过再派。
- **隔离**：改代码或依赖的并发线各用独立的 git worktree 和分支；只写文档或过程文件、且路径与其他线完全不重叠的，可以留在主目录。主 agent 在派发时写明每条线可以改哪些目录。
- **共享文件**：根 `package.json`、`pnpm-lock.yaml`、`packages/shared/`、`apps/worker/src/constants.ts`、`apps/worker/migrations/` 同一时间只交给一条线改；其他线需要改时在汇报里提出，由主 agent 合并时处理。迁移文件按线预先分配编号，避免撞号。
- **数量**：同时运行的实现子 agent 默认不超过 3 个（txapi 通道并发过高时出现过 `ECONNRESET`）；只读的评审子 agent 不计入。
- **上游超时**：子 agent 因 `Timed out waiting for response …` 中断时，先用原会话续跑一次；同一会话再次超时，就把剩余工作拆成范围更小的新会话，并要求精简报告。
- **合并**：主 agent 逐条线合并回 `main`，每次合并后在合并结果上重跑 `pnpm install`、`typecheck`、`lint`、`test`、前端构建，全部通过才提交。

## 采用的默认决策

用户未逐项确认，按 `docs/design/README.md` §6 的默认值执行：

- D1 前端：React 19 + Vite + Tailwind v4 + Radix + TanStack Router/Query
- D2 按 Workers Paid 设计；D3 两个项目同账号；D4 `MAIL_DB` 严格只读
- D5 中文为主，保留 i18n 结构；D6 链接可多地址，上限 50
- D7 OAuth 登录后不再要求本地 2FA（可配）；D8 名称 MailLink
- D9 API 令牌放二期；D10 平台预设用文档里的 9 个
- 视觉方向：用户尚未确认。暂按"A 分拣台为底 + B 的密度与批量工具栏"实现（Agent 推断），所有取值走语义 CSS 变量，便于之后更换。
- 取件页：验证码卡片与列表加详情两种状态都做，由规则组视图决定。
- 实现中的偏离（主 agent 决定，设计文档暂不改）：
  - 不引入 drizzle。APP_DB 用手写的参数化 SQL，集中在 `apps/worker/src/db/`，行类型用 TS 类型或 zod 定义（01 §1 原写 drizzle）。理由：迁移 SQL 必须与 01 §5 逐字一致，drizzle 生成迁移反而要两边对齐；查询量不大。
  - 测试包用 `@cloudflare/vitest-plugin`（`@cloudflare/vitest-pool-workers` 已改名）。
  - 健康检查在 MAIL_DB 不健康时返回 503。
  - 取件页状态（02 §6 与 05 §3 冲突，主 agent 裁定）：总次数用尽、撤销、暂停、过期统一显示"已失效"；每日上限用尽单独提示大约何时恢复（窗口内最早一次取码 + 24 小时）；设备数已满单独提示并展示链接的 `public_note`。
  - Turnstile 是取件页"不加载第三方资源"的唯一例外：只在链接开启人机验证时、只在"开始取码"这一步按需加载。
  - 设计令牌唯一来源为 `apps/web/src/styles/tokens.css`；原型与校验脚本放 `design/`，随仓库提交。
  - 初始化时不把默认设置写入 `settings` 表，读取时库里没有的键取代码里集中定义的默认值（03 §2 原写"写入默认设置"；效果相同，避免默认值存两处）。
  - `PATCH /api/me` 允许用户改自己的邮箱（03 §6 只列了显示名与密码）。本地邮箱不经验证，所以 M5 的"按已验证邮箱自动关联 OAuth"只能信 IdP 侧的 `email_verified`，且仍默认关闭；M5 派发时要明确这一点。
  - 详情判定用的正文（02 §5 与 §7 冲突，主 agent 裁定）：§5"用完整正文再判一次"理解为"重新解析原文、不信任索引"；判定用正文仍截到 `BODY_INDEX_CAP_BYTES`，`body_truncated` 按 §3.5 不可见、详情 404，与列表一致。原因：§7 的正则回溯防线以被匹配文本 ≤32 KB 为前提，详情跑完整正文时 200 KB 正文可达 15.7 s。展示正文仍用 `display_body`。
  - `max_mails` 是全局上限：列表首页、增量轮询、详情都以"最新 N 封"这一个集合为准（轮询不得绕过）。
  - 限流：`wrangler.jsonc` 正式配置 `RATE_LIMITER` binding；运行时缺失时受保护接口返回 503 `rate_limiter_not_configured`，health 标出未配置（01 §2"不静默放行"）。
  - 用户收件箱的邮箱参数用 04 原写的 `mailbox_id`（收件地址 id），不用授权 id：同一用户对同一地址最多一条授权（UNIQUE(user_id, mailbox_id)），地址 id 足以唯一定位授权。`/api/me/mailboxes` 每项同时给出 `mailbox_id` 与 `grant_id`。
  - 授权换成 `first_access` 锚点的规则组时沿用原 `first_access_at`（换组不重置计时；需要重新计时就删掉重建授权）。
  - 取件页 Turnstile 只看链接自己的 `access.turnstile`：开了才校验（系统未启用或范围不含 pickup 时 503），没开就跳过；系统的 pickup 范围只决定"允许链接开启"。
  - 取件页只显示 data URI 形式的站点 Logo（https Logo 会违反"取件页不加载第三方资源"），由 `GET /api/s/:token` 在 Logo 不是 data URI 时不返回（M3b-2 接线时做）。
  - 管理员强制 2FA 目前按"未启用 TOTP 且非通行密钥会话"判定，已启用 TOTP 的管理员走 OAuth 单因素会话也能进管理端；收紧为看会话 `auth_methods` 放到 M7b 加固（需同时让开启该设置时有 TOTP 的管理员走 OAuth 也进入 pending_auth）。
  - 登录页 Turnstile（05 §3"开启人机验证时带 Turnstile"）：UI-4a 未接、UI-4b 按分工不碰登录页。合并顺序改为 UI-4b 先合入 main（已验收通过），UI-4a 修复时合入 main 后用 UI-4b 的 `TurnstileWidget` 给自己的登录页密码表单带上 `turnstile_token`（action `login`）。**发布阻塞项（已解决，UI-4a `ad98a56`，复验实测通过）**：接好之前，管理员若在设置页把 login 加入验证范围，所有密码登录都会失败。
  - 设了口令的链接，访客通过口令前 `GET /api/s/:token` 不返回收件地址（卖号场景里收件地址就是登录邮箱，口令要连账号身份一起挡住）。
  - 附件下载写 `download` 日志是"GET 无副作用"的唯一例外：要求已登记访客 Cookie，预览机器人在写入前就被 401 挡住，且不改变激活、设备、计次。
  - M3b-2 修复时的取舍（已接受）：迁移 0006 新增表 `link_password_attempts`（IPv6 按 /64 合并计数，访问日志里的完整 IP 文本无法按网段比较），过期行由 M7b 的每日 cron 清理；新增 HKDF 用途 `linkVisitorCookie`（不让 AES-GCM 加密密钥跨算法使用）；导出行模板完全不做公式中和（输出是贴进发卡平台的纯文本，只中和行首也会改坏 `-foo@x.com`），CSV 模式照常中和；按链接的口令全局上限（15 分钟 20 次）是可被利用的锁，阈值可调。
  - 取件链接 M3b-2 的取舍（已接受）：总次数用尽在限流之后、访客 Cookie 之前判定（对外等同"已失效"，与访客无关）；IP/国家被拒归入"已失效"；拒绝日志只在 POST 上写，GET 不写（避免预览机器人与轮询刷日志）；访客 Cookie 名 `mlv_<链接id>`；撤销为终态；`access/tester.ts` 加可选 `anchors` 让管理员预览复用测试器。
  - OAuth 绑定入口（对 04 §认证路由的修订）：`GET /api/auth/oauth/:slug/start` 只用于 `mode=login`；绑定改为 POST（经 CSRF 中间件）且要求近期再确认，服务端生成绑定到当前会话的 state 并返回 `authorize_url`，`GET …?mode=link` 明确拒绝。理由：GET 可被跨站导航发起，默认 OAuth 登录不要求本地 2FA，静默绑上的身份等于绕过 2FA。
  - 收件地址导入列序按 06 §8："地址, 标签（平台）, 备注"（05 只说"可带备注与标签列"未定顺序，以 06 为准）；原实现"地址, 备注, 标签"由 FIN-C 改正。
  - 端到端测试用 Playwright Test 驱动本机 Google Chrome（`channel: "chrome"`，不下载浏览器），放 `apps/e2e`，以 `pnpm e2e` 单独运行、不并入 `pnpm test`；每次运行用全新本地数据目录，绝不连真实 Cloudflare。
  - 取件页 `/s/*` 不经过根路由守卫的初始化检查（不请求 `/api/setup/status`）：取件页是对外入口，买家不应多一次往返，也不应因该请求失败进入路由错误页。
  - MAIL_DB 迁移防护（对 01 §2 的修订）：wrangler 4 在 D1 绑定未配 `migrations_dir` 时默认用 `./migrations`（即本项目 APP_DB 的迁移），误敲 `wrangler d1 migrations apply MAIL_DB --remote` 会把本项目建表语句执行到 temp_email 的库。改为给 MAIL_DB 显式配置一个只含说明文件、不含 SQL 的专用空目录，并只提供针对 APP_DB 的迁移脚本；部署文档写明风险。
  - 限流拆成两个 binding（对 01 §2 的修订）：`RATE_LIMITER`（登录、初始化、注册、再确认类接口，10 次/60 秒）与 `LINK_RATE_LIMITER`（取件链接公开接口，阈值容纳正常轮询）。原因：Workers Rate Limiting 一个 binding 只有一组阈值，共用会让正常取件被误拦。
  - 限流的已知取舍：simple binding 不能只数失败，任何人从多个 IP 每分钟发 10 次即可锁住某个用户名的登录；NAT 后多人共用 `login:ip` 配额。按用户的第二因素失败上限由 M5 在应用层实现，不依赖 binding。
  - M2 / M3a 分工：内置验证码提取与 `category` 分类在 `mail-parse`（M2，符合 01 §1）；规则组级的 `code_regex` 与 `login_link` 提取在 `rules`（M3a）。两边以 01 §4.1 的 `MailFacts` 对接，具体 TS 结构由主 agent 在两份派发说明里写成同一份，M3b 合并时去重。

## 邮件 HTML 展示的硬性要求（M3a 安全评审给出，M3b 与前端派发时必须照抄）

1. iframe 必须正好是 `sandbox="allow-popups allow-popups-to-escape-sandbox"`，绝不加 `allow-scripts`、`allow-same-origin`、`allow-forms`、`allow-top-navigation*`、`allow-downloads`；`html` 原样放进 `srcDoc`，前后不加任何内容。
2. 清洗失败（如 lol-html ParserError）时绝不回退到原始 HTML：只返回纯文本或明确错误码并记日志。管理员预览同样走清洗加包装，不输出原始 HTML。
3. srcdoc 继承父页面的 CSP 与 Referrer-Policy：父页面保持 `Referrer-Policy: no-referrer`；父页面 CSP 需允许 `style-src 'unsafe-inline'`；`remote_images=allow` 时父页面还需 `img-src data: https:`。
4. 主题、预览、正文、发件人、`public_note` 一律按纯文本显示：不自动链接化，不用 `dangerouslySetInnerHTML`（纯文本里的裸域名与 IPv4 不会被替换，靠这一条保证不可点）。
5. `login_link` 与 `code` 只有在匹配 `^https?://` 时才渲染成链接，并加 `rel="noopener noreferrer"`。

## 后端待补（前端发现的缺口，排进对应里程碑）

- 用户列表响应缺总数，`DESIGN.md` 要求页头显示"共 N 个"（M7 或 UI 收尾时补）。
- 缺"注销我的其他会话"批量接口，账号页目前逐个调用 `DELETE /api/me/sessions/:id`（M5 账号安全页时补）。
- `/api/public/config` 缺 logo 与公告（M6）。
- 深色用户首屏闪浅色：M6 接外观接口时加 `<meta name="color-scheme">` 与内联预设脚本。
- 主 chunk 518 kB（UI-2 后 553 kB）：页面增多后对 `/admin/*` 做路由懒加载。
- "全部邮件"详情的"以此邮件创建规则"（05 §3）：等规则组编辑页（UI-3+）时补，后端 `draft-from-mail` 已在 M3b-1。
- 管理员"全部邮件"列表无总数（同用户列表）。
- UI-3 提出的后端缺口：收件地址标签清单接口；收件地址列表"有链接/无链接"筛选与启用/停用计数；测试器对不可见邮件不返回发件人与主题；shared 缺 `draft-from-mail` 响应 schema；父页面 CSP（`style-src 'unsafe-inline'`、`img-src data: https:`）与 `Referrer-Policy` 响应头（M7b 加固时统一设）。
- 取件页路由大小写：TanStack Router 默认不区分大小写，`/S/<token>` 也能打开取件页但拿不到 `_headers` 的 `no-store`/`noindex`；UI-5 合并时给 `/s/$token` 设 `caseSensitive: true`（或 `_headers` 补规则）。
- M7b-1 新增但前端尚未接线的后端字段（`total`、测试器、`/inbox` 归 M7b-2a；标签清单与 `has_link` 归 M7b-2b）：标签清单接口（收件地址页标签筛选候选）、`has_link` 筛选、测试器不可见邮件的发件人与主题、用户列表 `total`（页头"共 N 个"）；`/inbox`"全部"打开详情时带上列表项自己的 `mailbox_id`。
- 用户收件箱"全部"的列表项不带 `mailbox_id`/`view`，前端分不清 `meta_only` 与 `full/text` 的邮件（目前点进去 404 时说明）；M7b 在列表项补 `mailbox_id`。

## 需要用户提供（不阻塞开发）

- 一封脱敏后的真实 iCloud HME 转发邮件（`.eml`）：用于确认 Apple 是否改写 `From`、`X-ICLOUD-HME` 的 `s=` 是信封发件人还是头部发件人、展示用哪个。目前实现：展示用 `From`，规则判定时 `From` 与 `s=`（仅 `p=` 等于收件地址时）都算候选。
- 视觉方向确认（当前为 Agent 推断，见 `DESIGN.md`）。

## 里程碑

状态：待办 / 进行中 / 待验收 / 通过 / 退回

| 阶段 | 内容 | 执行模型 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| M0 | 脚手架、两个 D1、迁移、健康检查、本地种子 | sonnet-5-5 | 通过 | 见记录 2026-11-20 M0 |
| UI-0 | `DESIGN.md`、设计变量、三个代表页的静态原型（与 M0 并发） | sonnet-5-5#high | 通过 | 见记录 2026-11-20 UI-0 |
| M1 | 初始化、账号密码登录、会话、用户与角色（后端）；含 M0 遗留修复 | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 M1 |
| M2 | mail-source / 解析（含内置验证码提取与 `category` 分类）/ mail_index、管理员全部邮件 | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 M2 |
| M3a | 规则引擎纯函数：schema 与保存校验、求值与 trace、时间下界、规则组级提取、呈现与 HTML 清洗、模板与预设、规则草稿 | opus-5-5#xhigh | 通过，已合并 | 见记录 2026-11-20 M3a |
| M3b-1 | 取件流水线（access）、收件地址 API、规则组 API（含测试器与草稿）、setup 写模板、管理员邮件 HTML、M3a 遗留加固 | opus-5-5#high（集成核心，按复杂任务升级） | 通过，已合并 | 见记录 2026-11-20 M3b-1 |
| M3b-2 | 取件链接管理 API 与公开取件接口 `/api/s/:token/*`（访问约束、设备、取码计次、预览、日志、导出） | opus-5-5#high | 通过，已合并 | 见记录 2026-11-20 M3b-2 |
| M4 | 用户授权、用户收件箱 | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 M4 |
| M5 | TOTP、Passkey、OAuth2/OIDC（后端），批量注销会话，公开配置登录方式 | opus-5-5#xhigh | 通过，已合并 | 见记录 2026-11-20 M5 |
| M6 | 系统设置、外观、注册、Turnstile（后端） | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 M6 |
| UI-1 | 前端基础（令牌接入、主题运行时、API 客户端、路由守卫）、三套外壳、`/setup` `/login` `/admin/users` `/account` | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 UI-1 |
| UI-2 | `/admin/mails`（队列 + 详情、筛选、partial 退避重取、原文与邮件头）与可复用邮件组件（`MailHtmlFrame` 等） | sonnet-5-5#high | 通过，已合并（HTML 正文字段待 M3b-1 合并后接线） | 见记录 2026-11-20 UI-2 |
| UI-3 | 收件地址页、规则组列表与编辑（含测试器）、全部邮件 HTML 接线与"以此邮件创建规则"、审计日志页 | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 UI-3 |
| UI-4a | 登录两步验证/通行密钥/OAuth、账号安全（2FA、恢复码、通行密钥、第三方账号）、用户侧板凭据清除与授权块、我的邮件 `/inbox` | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 UI-4a |
| UI-4b | 系统设置页（含外观实时预览、OAuth 提供方管理）、注册页、前端强调色算法切到 shared `theme-contrast` | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 UI-4b |
| UI-5 | 取件链接管理页、取件页 `/s/:token`（两种视图与全部状态）、收件地址页的"生成取件链接/授权给用户"批量入口 | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 UI-5 |
| M7a | 审计日志列表、cron（预热 mail_index、每日清理）、限流基础设施 | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 M7a |
| INT-1 | M3b-2 × M6 集成：链接允许 Turnstile、"开始取码"接入 Turnstile、`GET /api/s/:token` 带出品牌/公告/data URI Logo/site key、创建链接用默认值、cron 清理 `link_password_attempts` 与 `auth_flow_tokens` | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 INT-1 |
| M7b-1 | 安全加固（页面 `_headers` 构建时生成含内联脚本哈希的 CSP、API 安全头、管理员强制 2FA 口径收紧）、后端缺口（收件箱列表 `mailbox_id`/`view`、标签清单、有无链接筛选与计数、测试器不可见邮件发件人主题、`draft-from-mail` schema、公开配置 `password_min_length`、用户列表 `total`）、`docs/deploy.md` | opus-5-5#high（含安全加固，按复杂任务） | 通过，已合并（见记录 2026-11-20 M7b-1）；过程：`ac07fb1` 交付 → `75a2a37` 合入 UI-3/UI-4b → `831e0dc` 前端适配 → `016b4a7` 合入 UI-4a → `011c37a` 适配 UI-4a、`/inbox` 改用列表项 `mailbox_id`/`view`；worker 1554 + web 459 通过；`_headers` 含 1 个内联脚本哈希；安全加固 opus-5-5#xhigh `ses_e08b851b9ffewKye8kbyRH6pZr`、缺口与部署文档 opus-5-5#high `ses_e08b826a9ffewKZ8R01m2zsWbU`；执行者另修 UI-3 偶发测试 `ImportDialog.test.ts`（点击后立即断言异步错误，单跑 6 次败 2 次；改为等待提示出现后断言，`e51482d`，主 agent 连跑 5 次全过）；未用迁移号） | 执行会话 `ses_e08e1db45ffe0KGf6OaDUOE0g9` |
| M7b-2a | 前端收尾：UI-4b 验收 5 条小改；接线用户列表 `total`、测试器不可见邮件发件人/主题、`/inbox`"全部"详情带 `mailbox_id`（不碰 mailboxes/links/pickup，避开 UI-5） | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 M7b-2a |
| M7b-2b-1 | 端到端测试框架（`apps/e2e`，Playwright Test + 本机 Chrome，不下载浏览器；`pnpm e2e` 不并入 `pnpm test`）+ 已合并流程用例：初始化、TOTP/恢复码、通行密钥、收件地址导入、规则组测试器、用户授权与 `/inbox`、HTML 邮件 sandbox、权限/CSRF/Origin/安全头；全局断言无 CSP 违规与第三方请求 | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 M7b-2b |
| M7b-2b-2 | 取件闭环 E2E（管理端创建链接 → 口令、click 取码、设备上限、仅每日用尽保留码、总次数用尽停止轮询、撤销后失效、无第三方请求）；由 M7b-2b-1 执行者在其框架交付后接着写；并入种子脚本支持 `PERSIST_TO`（授权改 `apps/worker/scripts/seed-mail-db.ts`，删 `node --import` 钩子）、"授权给用户"E2E；轮询断言用 `page.clock` | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 M7b-2b |
| FIX-RL | worker `ratelimit.test.ts` 真实 binding 用例偶发失败（全量并行时 1 次，单跑 8 次全过）：查清本地限流时间窗根因后按根因修，不靠盲目重试 | sonnet-5-5#medium | 通过，已合并（根因：miniflare `ratelimit-object.worker.js` 按 `floor(Date.now()/period)` 墙钟对齐固定窗口，跨 epoch 计数清零；`withinOneWindow`：离窗口末尾不足 15s 先等到下一窗口，连发后跨窗则断言失败、不静默重试；4 个连发到上限的用例都包上；两 binding 均 60s 且测试已断言相等；执行者单跑 10 次 + 3 进程并发全量 2 轮全过，主 agent 核对 diff 后合并） | 执行会话 `ses_e086db839ffeNTq9fViNL7A9Tg` |
| M7b-2c | 收件地址页：标签筛选候选改用标签清单接口（含次数与 `truncated` 提示）、"有没有取件链接"筛选 | sonnet-5-5#medium | 通过，已合并（见记录 2026-11-20 M7b-2c）；过程：验收"有条件通过"，修完主 agent 核对即合并：`/tags` 失败时候选静默变空——就地报错+重试；并入 `summary-filter` 可访问名称去掉伪元素"·"、"最近来信"跨年只显示日期+`title`、datalist label 改"N 个地址"、筛选首项改"取件链接：全部"。真实后端实测：40 地址/18 有链接，候选 `OpenAI（25）…` 只请求一次 `/tags`，有/无链接 18/22 行与接口一致，跨页全选"选择全部 22 项"请求带 `has_link=false`）；之前：待验收（`0f81e58`，只改 `apps/web/src/` 8 文件；web 64 文件 585 + worker 1557 通过；执行者截图只用了 mock 后端，验收须补真实后端实测；验收 opus-5-5#high `ses_e0878b045ffeQ1T8QSPd6JBfAR`，端口 8820） | 执行会话 `ses_e087db956ffecqpqtHp1OlipPo` |
| 终验 | 整体验收 | fable-5-2#xhigh | "有条件可以发布"，无代码级阻塞（见记录 2026-11-20 终验）；8 条"应尽快修复"分派 FIN-A/B/C，合并后由同一评审会话复核增量 | 评审会话 `ses_e0847ba58ffeGGH4p74GNU0b7K` |
| FIN-A | 终验安全修复：OAuth 绑定改 POST + CSRF + 再确认（GET `mode=link` 拒绝）；取码记录加邮件身份字段防 id 复用误判（迁移 0010）；`/api/*` 默认 `no-store`；MAIL_DB 只读守卫扩到全仓 | opus-5-5#xhigh | 进行中（worktree `fin-a-security`，分支 `fina`，基于 `e44fb6a`，端口 8822；授权改 worker、shared（本任务所需）、web 账号页 OAuth 绑定、迁移 0010） | 执行会话 `ses_e0828e616ffe74EiyVfsPaFDrz` |
| FIN-B | 终验前端修复：认证页与工作区显示站点 Logo（data URI 与 https，取件页仍只 data URI）/描述/页脚；390 宽管理端表格可读；`auto` 方式"24h"显示"—"；各管理页一个 `<h1>` | sonnet-5-5#high | 已合并，待终验复核（主 agent 核对：共用 `logoSource(value, "app"\|"pickup")`，取件页只认 `data:image/` 且有测试；认证页 Logo/描述/页脚、侧栏 Logo 与页脚，加载失败回退默认图标；≤520px 面板横向滚动 + 各表最小宽度，390 下关键列宽实测；`auto` 链接"24h"与"累计取码"显示"—"；规则组编辑页 `sr-only` `<h1>`，9 个管理页各一个 h1；web 66 文件 603 + worker 1557 通过；看 `login-390`、`links-390` 截图。遗留：设置页 OAuth 提供方表与账号页会话表未加窄屏滚动） | 执行会话 `ses_e0828800fffeQY0b2pqdsRUezd` |
| FIN-C | 终验规则与文档：模板 A 高危分类词表补措辞与多语言（验收 13 封高危样本做夹具，3 封曾漏判）；导入列序按 06 §8 改为"地址, 标签, 备注"；`docs/deploy.md` 补冒烟项、Turnstile 配错自救 SQL、zone 功能与 CSP、`d1 create` 答"否"、登录失败审计刷量建议、已知限制 | opus-5-5#high | 进行中（worktree `fin-c-rules-import-docs`，分支 `finc`，基于 `e44fb6a`，端口 8824/e2e 8817） | 执行会话 `ses_e0827eac5ffeRHjt1W23QusPx1` |

## 记录

### 2026-11-20 M0 通过

- 执行：sonnet-5-5（`ses_e0b2538f6ffe1AWRyxiru91xM9`）；验收：opus-5-5#high（`ses_e0b1b91f3ffeB5rXHACg7v7bHS`），结论"通过"，无阻塞项。
- 主 agent 复跑：`pnpm install` up to date；typecheck、lint 三个包 Done；`pnpm test` 5 文件 49 用例通过；web build 成功。
- 验收方复跑：8790 端口 `wrangler dev`，健康检查 200、`healthy:true`、`db_version v0.0.11`；未灌种子时 503 且列出 `missing_required`；`0001_init.sql` 与 01 §5 逐字一致。
- 遗留改进（已在 M1 处理，种子样本留给 M2）：只读守卫漏掉 `REPLACE INTO` / `PRAGMA x=` / `VACUUM` 且误报 `cache.delete`，去注释函数未单测；探测抛异常时未清缓存；`ZodError` 全局映射为 400；健康检查异常未打日志；`.gitignore` 补 `.env*`；ESLint 缺 `complexity: 10`；`engines` 应为 `>=22.18`；种子缺带 `metadata.ai_extract` 的样本（M2 处理）。

### 2026-11-20 M1 通过

- 执行：sonnet-5-5#high（`ses_e0b143fc2ffeYi6yHElI5ybtb2`）；验收：opus-5-5#high（`ses_e0b03906cffepZy5Ut5ujiAE6p`），结论"通过"，无阻塞项。
- 验收方 curl 复核（端口 8792，临时 D1）：setup 201 / 再次 404；错误密码与不存在用户都是 401 `invalid_credentials`，耗时都约 10ms；Cookie `HttpOnly; Secure; SameSite=Lax`；未登录 health 401；普通用户访问 admin 403；最后管理员降级/禁用/删除均 409，并发互相降级后仍剩 1 个启用管理员；缺 CSRF 头、错误/缺失/尾斜杠/大写 Origin 均 403；改密码后其他会话 401；禁用后旧会话 401；带旧 sid 再登录换发新 sid。
- 合并前小修（评审建议 1/2/4/5）：只读守卫 PRAGMA 改白名单（仅 `table_info`/`table_xinfo`）；密码哈希盐与哈希长度不符抛"数据损坏"；拒绝 `replace-with` 开头的占位 `APP_SECRET`；HTTP 状态码与若干常量去重。
- 主 agent 在 worktree 复跑：typecheck/lint 三包 Done；`pnpm test` 16 文件 195 用例通过。
- PBKDF2：迭代数取 100,000（社区与 workerd issue 记载的生产上限）；本地 workerd 不执行该上限，**部署后首次登录是这一点的冒烟检查**。
- 遗留：登录与 setup 限流（M7）；审计写入非原子（可接受）；过期会话只在访问时惰性删除（M7 cron）；`Secure` Cookie 在 Safari 本地 http 下不保存。

### 2026-11-20 UI-0 通过

- 执行：sonnet-5-5#high（`ses_e0b1c3838ffeaLtOMO7mb6Jy8M`）；验收：opus-5-5#high（`ses_e0b06d389ffeMo1DY6jpMZol9L`）。首轮"有条件通过"（5 项必修：强调色 hover/active 对比度、规范引用文件未入库、取件页状态缺项与两处文档冲突、取件页 44px 命中区、收件地址行内入口），修复后复验"通过"。
- 主 agent 复跑：`contrast.mjs` 98 项全部达标；`accent-test.mjs` 8022 组最差值 fg/accent 4.58、fg/hover 5.03、fg/active 5.58、accent/surface 3.00、accent/bg 3.00、accent-text 4.50，不可达时抛错；`check_design_md.py DESIGN.md` exit 0。
- 验收方独立复核：11664 组采样无抛错，默认深色 hover 6.00、active 7.17；无头 Chrome 390×844 触屏下取件页 27 个可点元素命中区全部 ≥44×44；取件页无外链资源；1440×900 悬停与 Tab 聚焦均可见行内操作。
- 交付：`DESIGN.md`（240 行，Agent 推断项已标注）、`apps/web/src/styles/tokens.css`（令牌唯一来源）、`design/prototypes/`（6 个原型页）、`design/scripts/`（对比度、强调色、命中区校验）。
- 遗留给 UI-1：`DESIGN.md` 末尾"UI-1 待办"8 条；"自动刷新已暂停""重取失败"两帧的弱化阈值与规范（10 分钟）不一致；外观设置页要把 `ensure()` 抛错显示为表单校验信息；根 ESLint 应忽略 `design/`。
- 视觉方向仍为 Agent 推断，用户尚未最终确认。

### 2026-11-20 M2 通过

- 执行：sonnet-5-5#high（`ses_e0af95654ffe8gLCLpGfD25CeW`）。验收：首个 opus 会话两次上游超时，拆为代码审查（`ses_e0a5b12a9ffesVi8kZqF0wQqw5`）与运行时/对抗样本（`ses_e0a5ae7e5ffetN34kn3OMvFEb0`）两个 opus-5-5#high 评审。首轮"有条件通过"，修复后复验"通过"。
- 首轮必修：链接超上限被丢弃致 `link.domains` 黑名单可绕过；HTML 转文本漏顶层文字、省略 `</head>` 时吞正文；解析失败行变"空 facts"会在黑名单模式失败开放；候选 SQL 外层 `COALESCE` 使热路径无法走索引；附件名截断切坏代理对致 500；展示正文丢失换行；对抗样本 4 个误判（`****1234`、页脚 `subscription` 判 billing、order/reference/折扣码、改密码短语）。
- 修复后主 agent 复跑：typecheck/lint 三包 Done；`pnpm test` 27 文件 429 用例通过；`mail-query-plan.test.ts`（2 万行 + ANALYZE，断言走 `idx_raw_mails_to_address`、无全表扫描）3/3；`PARSER_VERSION=2`。
- 运行时证据（端口 8795，临时 D1）：未登录 401、普通用户 403；冷索引 `partial` true→false；gzip 详情与 `?raw=1`；HME `p=` 不一致时 `s=` 不进候选；解析失败与原文丢失有标记；附件 `attachment`/`nosniff`/`octet-stream`/`no-store`；scope 3+16=19 无遗漏；MAIL_DB 缺 `raw` 列时邮件接口与 health 均 503。
- 对接 M3b：`IndexedItem` 为 `ok | failed | pending` 联合；`rowToFacts` 对非 ok 行抛错；`partial=true` 时调用方不得推进 `after_id`；展示正文用 `display_body`，不要用索引里的单行 `body_text`；`mail_index.sender_address`/`sender_domain`/`link_domains` 为 JSON 数组。
- 遗留：HME 发件人展示待真实样本；分类与提取词表是启发式，需真实平台邮件迭代；`normalizeText` 不处理 U+034F 等少见不可见字符与西里尔仿冒（二期）；"非预期异常不写索引"缺专门用例；cron 预热留 M7。

### 2026-11-20 M3a 通过

- 执行：opus-5-5#xhigh（`ses_e0b01926bffe5IzBcKngFJcl0C`）。验收拆为规则正确性 opus-5-5#high（`ses_e0a547e98ffeaxrCy5OUELggxV`）与清洗/呈现安全 opus-5-5#xhigh（`ses_e0a541dd7ffeZxtt2EqBpE0O7F`），两者首轮均"有条件通过"；修复后复验 opus-5-5#high（`ses_e0a2cf49effevpXV11wLCtHfzV`）"通过"。
- 首轮必修：正则静态检查漏"带量词组内重叠分支""固定次数套可变重复"（线上计时不可用时只给警告即可保存，失败开放）；包装层在清洗结果后追加 `</body></html>`，使末尾未写完的 `<img … onerror=…` 变成活标签。另修：重复属性整体删除、属性改白名单、CSS `src()`、片段链接不加 target、strip 处理带端口主机与裸 IPv4、清洗失败抛 `HtmlSanitizeError`、`code_regex` 主题无效时继续试正文。
- 主 agent 复跑：typecheck/lint 三包 Done；`pnpm test` 15 文件 619 用例通过。
- 复验证据：13 个危险正则全部被拒、5 个常用验证码正则与 6 个模板通过；HTML 清洗 97 向量 × 4 配置经 parse5 判定真实不安全数 0，另 16 个末尾截断变体全部安全；`select+style` 类输入抛 `HtmlSanitizeError`（失败关闭）。
- 留给后续（并入 M3b 第一步）：静态检查拒绝同一序列中相邻、字符集重叠的多个无上限量词（`x\w*\w*\w*!` 在 2 KB 上约 1.2 s，立方级）；`title/xmp/noembed/noframes/plaintext` 加入整段删除元素（`stripUnfinishedTail` 不认 RCDATA 上下文，当前包装方式下安全，属纵深防御）。
- 已知行为变化：`(?:\d{3}-?){2}` 被拒（常见写法 `\d{3}-?\d{3}` 可通过，报错文案有改写提示）。

### 2026-11-20 UI-1 通过

- 执行：sonnet-5-5#high（`ses_e0ae70100ffeING7eG5lOYmxZi`，中途一次上游超时后续跑）；验收：opus-5-5#high（`ses_e0a322769ffejjX5D7r8c35RDF`），首轮"有条件通过"，修复后复验"通过"。
- 首轮必修：URL 主题预览参数非法时 `startTheme()` 在挂载前抛错致整页白屏；出错页"重试"只 `reset()` 不重跑 `beforeLoad`；390 宽 `/account` 文档宽 674px。另修：ESLint 插件移到根 devDependencies 去掉 `createRequire`；批量注销会话 `onSettled` 刷新；窄屏侧板焦点管理；用户名截断加 `title`；补 401 跳转与重试恢复两条路由测试。
- 主 agent 复跑：typecheck/lint 三包 Done；`pnpm test` web 9 文件 59 用例 + worker 16 文件 195 用例通过（执行者干净安装后连跑 3 次全过）；web build 成功。截图确认 `?theme=sepia` 顶部提示且页面照常渲染、390 宽账号页无溢出。
- 复验实测（headless Chrome + CDP）：`theme`/`accent`/`radius` 非法值均显示提示不白屏；首次 `/api/setup/status` 失败后点重试会再发请求并恢复；390×844 `/account` 文档宽 390；窄屏侧板焦点进入、Esc 关闭并回到原行。
- 保留 happy-dom：vitest 下无 `document` 时 TanStack Router 判定为服务端模式，导航行为不同；强制客户端又会访问 `window`。
- 遗留：深色首屏闪浅色（M6）；主 chunk 518 kB（路由懒加载）；用户列表无总数（后端待补）。

### 2026-11-20 UI-2 通过

- 执行：sonnet-5-5#high（`ses_e0a10cc85ffe3001C80GaFTLEF`）；验收：opus-5-5#high（`ses_e09c44082ffeut0sP0NiDY7SBO`），"有条件通过"，1 项必修：详情"链接列表"把不可信邮件里的 http(s) 链接做成可点 `<a target=_blank>`，管理员误点可能消耗买家一次性令牌。修复为等宽纯文本 + 复制按钮。
- 必修项由主 agent 直接核对（改动小、可机械验证）：`MailDetailSections.tsx` 无 `<a`/`href=`（仅注释提及）；新增测试断言链接列表与正文区无 `<a>`；截图 `ui2-shots/detail-links-light.png` 确认。
- 主 agent 复跑：web 14 文件 111 用例通过；首轮复跑 worker 37 文件 999 用例通过；改动只在 `apps/web/`、无新增依赖。
- 验收确认：iframe sandbox 精确为 `allow-popups allow-popups-to-escape-sandbox`、`srcDoc` 原样；纯文本不链接化、全仓无 `dangerouslySetInnerHTML`；partial 1s/2s/4s 退避不推进游标、筛选变化时旧请求作废无竞态；队列行两行（约 60px）符合 DESIGN.md（36px 只针对表格）；构建 3 分 28 秒复测 2.78 s，系机器负载。
- 另做：`mailsRoute` 专属错误页留在工作区并可"清除筛选"；刷新保留旧列表。

### 2026-11-20 M3b-1 通过

- 执行：opus-5-5#high（`ses_e0a269005ffeXXMzyWYgGFPNQw`）。验收拆为流水线安全 opus-5-5#xhigh（`ses_e09c2594fffe310opffzJcjwc5`）与收件地址/规则组 API opus-5-5#high（`ses_e09c21bc7ffeuLXX0Zn0mQyzU1`），两者首轮均"有条件通过"；修复后流水线评审复验"通过"。
- 首轮必修：增量轮询（`after_id`）绕过 `max_mails`（复现 `max_mails=2`、6 封，从 0 轮询拿到全部 6 封）；详情用完整正文跑管理员正则打破 02 §7 回溯防线（`code\w*-?\w*!` + 200 KB 正文详情 15.7 s）；`extractHtmlOrFail` 把所有异常转成解析失败；两处 magic number。另修：导入标签改 `INSERT … RETURNING` 按 id 写；批量删除审计带地址与引用数；收件地址路由 `no-store`；setup 模板插入条件精确化。
- 主 agent 复跑：typecheck/lint 三包 Done；`pnpm test` 42 文件 1092 用例通过；`apps/worker/src` 无 `truncateBody`。
- 复验证据（原复现脚本）：从 `after_id=0` 轮询只得 [5,6]，与首页一致；200 KB 正文详情 0.7 s、404，与列表一致；`scanNewestVisible` 遇未就绪或触到 `SCAN_CAP` 时只返回已确定的可见邮件（失败关闭）。
- 首轮已确认：详情与附件每次重走完整检查且不读 `mail_index`；8 类越权 mail id 统一 404；时间与地址下推进 SQL；partial 游标不漏不重；规则组乐观锁单语句原子；测试器只写 `mail_index`；setup 管理员与 6 个模板同一 batch。
- 对接 M3b-2 / M4：`access` 导出 `listVisibleMails`、`getVisibleMailDetail`、`getVisibleAttachment`、`testRuleGroup`、`compileStoredPolicy`、`grantPolicy(null=黑名单·无规则·full)`；规则组编译失败抛 503；`HtmlSanitizeError` 只回 text。
- 遗留：设了 `max_mails` 时详情/附件每次多扫一遍首页（最坏约 40–45 次查询，Paid 下可接受）；只隔可省略原子的重叠量词（如 `x\d+-?\d+y`，平方级）静态放行，靠长度上限兜底。

### 2026-11-20 M7a 通过

- 执行：sonnet-5-5#high（`ses_e09bdba94ffe2IAefGi5c5A1sV`）；验收：opus-5-5#high（`ses_e09480745ffeCj2nAAltk7Z8W8`），"有条件通过"，1 项必修：再确认类接口（`POST /api/me/password`、注册、TOTP、恢复码、通行密钥管理）未挂限流。
- 修复由主 agent 直接核对（可机械验证）：`constants.ts` 的 `RATE_LIMITED_ROUTES` 覆盖登录（IP + 用户名）、注册、初始化、`/api/auth/mfa/*`、`/api/auth/passkey/*`、`/api/auth/oauth/*`、`/api/me/password`、`/api/me/totp/*`（POST/DELETE）、`/api/me/recovery-codes`、`/api/me/passkeys/*`（POST/PATCH/DELETE）；`index.ts` 遍历清单挂载；覆盖测试遍历 `app.routes` 并自检能报出清单外路由（2 条通过）。
- 主 agent 复跑：typecheck/lint 三包 Done；worker 40 文件 1083 用例、web 111 用例通过；web build 成功。
- 验收确认：限流 key 无碰撞；`CF-Connecting-IP` 由边缘覆盖不可伪造；缺 binding 503、超限 429 带 `Retry-After`、binding 抛错 500，均不放行；尾斜杠/大写/双斜杠路径 404、URL 编码照样限流；cron 不写 MAIL_DB、预热游标不跳邮件、孤儿清理在 MAIL_DB 不健康时中止不删；日志保留边界有测试；审计列表 zod 校验与 `no-store`。
- 另做：第二个 binding `LINK_RATE_LIMITER`（120 次/60 秒，`link` 用途专用，缺失同样 503）；登录类请求体 >4 KB 返回 413；审计列表返回前递归剔除敏感键；审计游标与时间参数严格数字校验；删除过时 `TODO(M7)`。
- 遗留：两个 binding 的 `namespace_id`（1001/1002）为占位值，部署前按账号调整；本地触发 cron 用 `/cdn-cgi/handler/scheduled?cron=…`（`/__scheduled` 被 SPA 兜底截走）；清理单次上限（日志每表 5 万行、孤儿索引 1 万行）超出时 `last_run` 未标"截断"。

### 2026-11-20 M5 通过

- 执行：opus-5-5#xhigh（`ses_e0a26007fffe162XUPKIsWf9PB`）。验收拆为 TOTP/通行密钥/Cookie（`ses_e095117c5ffe9SrzWGQkrJ8FfF`）与 OAuth/OIDC（`ses_e0950cdefffe03lkP6zljipx8r`）两个 opus-5-5#xhigh 评审，均"有条件通过"；修复后复验 opus-5-5#high（`ses_e0938f8feffeQl5cj43jf7W3JM`）"通过"。
- 首轮必修：启用 2FA 与添加通行密钥前未再确认身份（拿到会话即可种下绕过 2FA 的通行密钥，已实测复现）；OAuth 回调不再检查 `auth.login_methods`；OAuth 失败不入审计。并入：按用户 id 跨 IP 的第二因素失败上限（15 分钟 10 次锁 15 分钟，登录第二步与再确认共用）；有绑定时禁止改提供方 issuer/kind/端点/client_id；管理员改邮箱才置 `email_admin_set`；拒绝空标签主机名、只允许 443；`maxTokenAge` 与 `azp` 必须等于 `client_id`；先抢占 `pending_auth` 再消耗因素；启用 2FA 与写恢复码同一 batch；"剩余登录方式"考虑 `auth.login_methods`；补并发测试。
- 合并：主 agent 先把 main（M3b-1、UI-1、UI-2、M7a）合入 `m5`（`d269d88`），解决 `audit.ts`/`constants.ts`/`db/settings.ts`/`index.ts`/shared 导出/锁文件 6 处冲突（均为追加；`auth.login_methods` 默认取 M5 的三项）；合并后 typecheck/lint 三包 Done，worker 54 文件 1261 用例、web 111 用例通过，web build 成功，M7a 受保护路径覆盖测试在 M5 真实路由下通过。
- 复验证据：只有会话不知密码时启用 2FA 与注册通行密钥均失败且无写入；关闭 oauth 后回调 `provider_unavailable`、不换 token；伪造 HS256 id_token 留下 1 条 `auth.login_failed`；15 个并发错码正好 10×401、5×429；锁定后恢复码登录、重新生成恢复码、通行密钥 options 均 429，恢复码未被消耗。
- 首轮已确认：TOTP 时间步一次性（6 并发同码只 1 成功）、恢复码原子（5 并发只 1 成功）、`pending_auth` 并发计数正好 5；通行密钥凭据归属、challenge 一次性、"计数器固定 0"不削弱库检查；Cookie 类型隔离；PKCE、state/nonce 一次性、alg 白名单；SSRF 出口 20+ 绕过写法被拒；自动关联 8 条规则全部强制。
- 遗留：无法防 DNS rebinding（Workers 无 DNS 结果）；OAuth link 模式不要求再确认；知道密码者可故意输错锁住某用户 2FA 15 分钟（按用户上限的固有代价，有审计）；密码登录本身尚不受 `auth.login_methods` 控制（M6）；前端登录页尚未处理 `mfa_required`（UI 线）。

### 2026-11-20 M4 通过

- 执行：sonnet-5-5#high（`ses_e094878daffeBlFSsR5d2jlAep`）；验收：opus-5-5#high（`ses_e09333d61fferG8LbScGdgFLup`），首轮"有条件通过"，修复后复验"通过"。
- 首轮必修："全部"视图最多 20 个作用域 `Promise.all` 并行扫描，单次请求现场解析量与扫描行数超单作用域上限 20 倍；`first_access_at` 在构造作用域前写入，422/503 失败的请求也开始计时。主 agent 裁定：参数改回 04 的 `mailbox_id`（收件地址 id）；换规则组沿用 `first_access_at`；批准给 `access/listVisibleMails` 加可选解析预算（向后兼容）。
- 修复：作用域顺序扫描并共用 `ParseBudget`（单次请求解析量同单作用域）；成功取到结果后才写 `first_access_at`；批量授权新增/更新/审计同一 `db.batch`；新增只读 `mail-source/latest.ts`。
- 主 agent 复跑：typecheck/lint 三包 Done；worker 59 文件 1321 用例、web 111 用例通过。
- 验收证据：越权（他人授权、过期/删除/停用、`code_only`/`meta_only` 详情、白名单外、`max_mails` 外）统一 404；`address_lc` UNIQUE 与 UNIQUE(user_id, mailbox_id) 保证按地址定位授权无旁路；随机模拟（首轮 5 种子 × 300 轮，复验另 5 种子 × 300 轮）翻页与 `after_id` 无漏无重；预算只有 `inbox/list.ts` 传入且固定，不能被请求放大；每次 partial 请求至少写回 1 封索引，不会饿死。
- 遗留：`mailbox_grant_count` 统计全部授权（含失效，前端标"含失效"）；"全部"请求会给规则组失效被跳过的授权写 `first_access_at`（影响小）；`after_id` 跨组时偶尔晚一轮拿全；`max_mails` 作用域每页取整组。

### 2026-11-20 M3b-2 通过

- 执行：opus-5-5#high（`ses_e0948db9effeKBWWnpHMEcs7Uv`）。验收拆为公开接口安全 opus-5-5#xhigh（`ses_e0929eca7ffeG70WQfaFPEjndA`）与管理端 opus-5-5#high（`ses_e0929a3adffe5oSTvS8KVEUtm3`），均"有条件通过"；修复后公开接口评审复验"通过"。
- 过程：`e8dacaf` 首交 → 主 agent 合入 main（M7a、M5）`17f994c` → 执行者接上 `LINK_RATE_LIMITER` `0e63a21` → 验收修复 `88b487d`。
- 首轮必修：口令锁定"先数再验再写"非原子，并发 20 次全部进入 PBKDF2 无一锁定；被拒的 POST 不经限流就写日志（可无限写 D1）；设口令链接未输口令即可看到收件地址（主 agent 裁定修）；批量创建每行重复公共字段，字段填满 × 500 约 3.3 MB 超 D1 单值 2 MB；PATCH 撤销终态先读后写有竞态。并入：按链接的口令全局上限与 IPv6 /64 合并；续费重发 Cookie；CSRF 拒绝带安全头；Cookie 名用 HMAC；rotate 可清设备；HKDF 每请求一次；导出模板不中和；映射地址 CIDR 转 IPv4。
- 主 agent 复跑（`88b487d`）：typecheck/lint 三包 Done；worker 60 文件 1355 用例、web 111 用例通过。
- 复验证据：并发 20 次错口令只 5 次进入 PBKDF2、15 次 429；40 个 IP 并发错后新 IP 正确口令也 429、已登记设备 start 200；同一 /64 换地址仍锁、相邻 /64 不受影响；被拒 POST 在限流器全拒时 0 条日志、放行时每请求只调一次限流器；首轮已确认 7 种 410 逐字节相同、设备与取码并发不超限（P2/P3a/P3b）、GET 无副作用、AAD 绑 `token_hash` 安全、rotate 原子、预览无副作用。
- 遗留：`link_password_attempts` 过期行待 M7b cron 清理；按链接口令上限可被用来挡新设备（有意取舍）；POST 与 GET 在 `total_limit` 与撤销之间的限流消耗差异（影响极小）。

### 2026-11-20 M6 通过

- 执行：sonnet-5-5#high（`ses_e0931a6edffeIdfcs1y2apCnZW`）；验收：opus-5-5#high（`ses_e091de33cffeL3cyVMwpnPPecd`），"有条件通过"，1 项必修：`turnstile/verify.ts` 的 `requirementFor` 让取件页忽略链接自己的 `access.turnstile`（系统范围含 pickup 时未开验证的链接也被要求校验，前端不加载控件会一律 400）。
- 修复由主 agent 直接核对（可机械验证）：`requirementFor` 现为 pickup 只看 `forced`、forced 时要求系统启用 + 范围含 pickup + 两把密钥，否则 503；login/register 只看系统设置。新增 hostname（`PUBLIC_ORIGIN` 主机名）与 action（= scope）校验；`/api/auth/session` 的 `expires_at` 取 `min(expires_at, created_at + 当前绝对时长)`；`anyAdminCanLogIn` 合并为一条 `EXISTS`。相关 10 个 Turnstile 用例通过。
- 主 agent 复跑（`d5556a9`）：typecheck/lint 三包 Done；worker 62 文件 1411 用例、web 111 用例通过。
- 验收确认：secret 独立 HKDF 用途 + AAD 加密、GET 只回 `secret_set`、审计不含 secret；公开配置是白名单；siteverify POST 表单、5 s 超时、16 KB 上限、`redirect: manual`；未配置 503、token 无效 400、不可达 503，均不放行；登录顺序 限流 → 登录方式 → Turnstile → 哈希；`login_methods_lockout` 与 `admin_2fa_lockout` 规则完整；会话时长"取较早者"与 cron 清理一致。
- 前端对接：Turnstile 控件 `action` 只能是 `login` / `register` / `pickup`；`PUBLIC_ORIGIN` 主机名须与控件所在域名一致。
- 遗留：管理员强制 2FA 判定口径收紧（M7b）；取件页 Turnstile 与"开始取码"接线、`pickup_notice`/`show_brand`/data URI Logo 带入 `GET /api/s/:token`、链接保存时允许 `turnstile=true`（系统已配置时）——M3b-2 与 M6 都合并后由集成任务完成；前端强调色改用 shared `theme-contrast`（UI-4b）。

### 2026-11-20 INT-1 通过

- 执行：sonnet-5-5#high（`ses_e09104474ffeMc0rGi2vOo7gh7`）；验收：opus-5-5#high（`ses_e09008246ffeiYFrkPscBKpXoO`），"通过"，无必修。
- 内容：系统配好 Turnstile（启用 + 范围含 pickup + 两把密钥）才允许链接 `turnstile=true`；"开始取码"在限流之后、口令占位与 PBKDF2 之前 `enforceTurnstile(c, "pickup", token, { forced })`，已登记设备跳过；`GET /api/s/:token` 新增 `turnstile: {required, site_key?}` 与 `site: {show_brand, name?, logo?(仅 data:image/), notice?}`；创建链接未给过期/轮询间隔时用 `links.default_*`；每日 cron 清理 `link_password_attempts`（`created_at < now - 窗口`）与 `auth_flow_tokens`（`expires_at <= now`）。
- 顺带修 M5 遗留偶发测试：`totp.test.ts` 断言随机 base64url 密文不含 `t1`（约 2% 碰撞），改为解码密文段后断言不含明文 JSON。
- 主 agent 复跑：worker 70 文件 1536 用例连跑多次全过；web 111 用例通过。
- 验收确认：Turnstile 失败时不占口令名额、不登记设备、不写 `first_access_at`；已登记设备跳过只认本链接 HMAC 名 Cookie 且在 `link_visitors` 可查；GET 无副作用；`site_key` 仅 required 时给，系统 key 缺失时 start 503（失败关闭）；https Logo 不返回；cron 删除条件与计数窗口口径一致（窗口起点那行保留）。
- 取舍（已接受）：`data:image/svg+xml` 放行（前端只能用 `<img src>` 渲染）；PATCH access 整体替换，不给的字段回到默认值（前端编辑表单须整体提交当前值）；默认过期从 `max(now, valid_from)` 起算；暂留重复字段 `requires_turnstile`（UI-5 对接后删除）。

### 2026-11-20 UI-4b 通过

- 执行：sonnet-5-5#high（`ses_e0904ddc7ffeZp1L3x9WEywhla`）；验收：opus-5-5#high（`ses_e08e336c5ffet6A2jn3ItWmtRZ`），"通过"，无必修。
- 内容：强调色算法只从 shared `theme-contrast` 导入（前端重复实现已删，测试断言 `THEME_GROUNDS` 与 `tokens.css` 一致）；主题读 `/api/public/config.appearance`，首屏 `color-scheme` meta + 最小内联预设脚本；系统设置页 9 组（外观实时预览可撤销、强调色不可达禁止保存、OAuth 提供方含自动发现与回调地址复制、系统状态只读缺列警告）；`TurnstileWidget` 按需加载、加载失败显式报错、token 一次性；注册页（关闭态、Turnstile 拿到 token 前不可提交、site key 为空时禁用不降级）。
- 主 agent 复跑（合入最新 main 后）：typecheck/lint 三包 Done；web 21 文件 173 用例、worker 70 文件 1536 用例通过；web build 成功。
- 验收实测：登录页、设置页、未启用 register 范围的注册页均不请求 challenges.cloudflare.com，启用后注册页才加载；Turnstile 失败后控件重置并显示中文错误；secret 留空不提交、不回显、不入存储；外观预览离开即清除内联覆盖；oauth 组不请求 `/api/admin/settings/oauth`。
- 待 M7b-2a 收尾的小项：两个 secret 输入框 `autoComplete` 改 `off`；Logo 读文件前先按 `file.size` 粗筛；默认强调色时可读性提示与 `tokens.css` 的 `accent-text` 值不一致；会话时长提示文案用 shared 常量；注册成功但取会话失败时提示"账号已创建，请去登录"。

### 2026-11-20 UI-3 通过

- 执行：sonnet-5-5#high（`ses_e09313850ffe7INAHx6EaIz0kU`）；验收：opus-5-5#high（`ses_e08e75a70ffe4crGQeP5OJz5F9`），"有条件通过"，2 项必修：JSON 模式语法错误时仍可保存"上一份能解析的配置"且离开不提示；两处写死 `maxLength`（规则组名称 200 与接口上限 64 不一致）。
- 修复由主 agent 直接核对（可机械验证）：语法错误时 `saveBlockedReason` 禁止保存并计为 1 处未保存（离开提示、可放弃）；`maxLength` 改用 `RULE_GROUP_API_LIMITS.nameMaxLength` 与 `RULE_GROUP_LIMITS.maxNameLength`。另修：全选 >500 明确报错；从邮件建草稿时测试器默认试跑该邮件；`REASON_TEXT` 按原因码联合类型定型；库内配置损坏时允许直接保存覆盖。
- 合并：主 agent 把含 UI-4b 的 main 合入 `ui3`，`endpoints.ts`/`queries.ts`/`router.tsx`/`styles/index.css` 追加冲突两边保留（`getAdminMail` 取 UI-3 新签名），执行者把超 70 行的 `createEndpoints` 拆为 `endpoints-admin.ts` 与 `endpoints-settings.ts`，并删掉与真页面重复的路由占位。合并后 typecheck/lint 三包 Done，web 33 文件 283 用例、worker 70 文件 1536 用例通过，web build 成功。
- 验收确认：iframe sandbox 精确、`srcdoc` 为后端文档；导入里的 `<img onerror>` 显示为文本；3 份复杂配置（嵌套 not/any、`case_sensitive`、`redact`、`extract`、`code_regex`、`allow_domains`、`since.fixed`、`max_mails`）表单 ↔ JSON 往返逐字一致；互斥约束当场说明原因；409 重新加载；测试器用未保存配置、防抖且旧结果不覆盖新结果；收件地址表 36px、红色只在删除、Tab 可达、对话框焦点陷阱；<1100 时测试器移到表单下方。
- 遗留（后端缺口，已在 M7b-1）：标签清单、有无链接筛选与计数、测试器不可见邮件的发件人与主题、`draft-from-mail` schema。

### 2026-11-20 UI-4a 通过

- 执行：sonnet-5-5#high（`ses_e091cec86ffeMdruzBXfSfQbgA`）；验收：opus-5-5#high（`ses_e08e3735fffeR02OJ3c0riBLei`），首轮"有条件通过"，修复后复验"通过"。
- 过程：`1fc05e5` 交付 → `754f4d5` 合入 main（M3b-2、M6、INT-1）→ `68d3150` 适配 M6 公开配置（测试夹具工厂、登录页按 `login_methods`/`login_notice`/注册入口、`admin_2fa_required` 引导）→ `ad98a56` 合入 main（UI-3、UI-4b）并修复。
- 首轮必修：启用/关闭 2FA 后未刷新会话缓存，`admin_2fa_required` 引导残留到缓存过期；登录页未接 Turnstile（发布阻塞项，主 agent 指派给 UI-4a）。合并时 `ApiError` 同时保留 `retryAfterSec`（UI-4a）与 `details`（UI-3）。
- 主 agent 复跑（`ad98a56`）：typecheck/lint 三包 Done；web 52 文件 458 用例、worker 70 文件 1536 用例通过；web build 成功。
- 复验实测（8810 + headless Chrome，管理员强制 2FA 开启）：启用 TOTP 后不刷新直接进 `/admin/users` 立即可用、提示条消失；登录页未启用 Turnstile 时对 challenges.cloudflare.com 请求数 0，启用后拿到 token 前禁用（回车也绕不过），`turnstile_failed` 后控件重置并显示中文说明，site key 为空时禁用不降级；`/account?oauth=` 读后清参数；恢复码阶段单主按钮。
- 首轮已确认：恢复码只在内存（确认后 DOM 无、不入任何存储/URL/日志）；`uqr` 本地生成二维码无网络请求；OAuth 结果码读后 replace 清除、未知码纯文本限长；登录状态机各错误码；再确认三种请求体；`admin_2fa_required` 时 `/admin/*` 不发请求；`/inbox` 的 `mailbox_id`、"全部"、`available=false`、`code_only`/`meta_only` 无详情、partial 不推进游标；新依赖 `@simplewebauthn/browser`、`uqr`。
- 遗留：`/inbox`"全部"按收件地址猜邮箱的逻辑待 M7b-1 合并后改用列表项的 `mailbox_id`/`view`；公开配置读取失败时密码表单不带 Turnstile（服务端会返回 `turnstile_failed` 并显示，可接受）。

### 2026-11-20 M7b-1 通过

- 执行：opus-5-5#high（`ses_e08e1db45ffe0KGf6OaDUOE0g9`）。验收拆为安全加固 opus-5-5#xhigh（`ses_e08b851b9ffewKye8kbyRH6pZr`，"通过"）与缺口/部署文档 opus-5-5#high（`ses_e08b826a9ffewKZ8R01m2zsWbU`，"有条件通过"，2 项文档必修）。
- 过程：`ac07fb1` 交付 → `75a2a37` 合入 UI-3/UI-4b → `831e0dc` 前端适配新必填字段 → `016b4a7` 合入 UI-4a → `011c37a` 适配并让 `/inbox` 改用列表项 `mailbox_id`/`view` → `e51482d` 修 UI-3 偶发测试 → `4cb5adc` 验收修复。
- 内容：构建后脚本从 `dist/index.html` 计算内联脚本哈希生成 `dist/_headers`（CSP、`Referrer-Policy`、`nosniff`、`X-Frame-Options`、`Permissions-Policy`，`/s/*` 另加 `no-store`/`noindex`），遇到内联事件属性、`javascript:` 链接或 script 属性含 `>` 时构建失败；`/api/*` 统一安全头；管理员强制 2FA 只认会话 `auth_methods` 含 totp/recovery/passkey，开启时有 TOTP 的管理员走 OAuth 也进 pending_auth，防锁死在两处检查；后端缺口 7 处；`docs/deploy.md`。
- 验收修复：`APP_SECRET` 先生成并存密码管理器再 `secret put`；**MAIL_DB 迁移防护**——`wrangler.jsonc` 给 MAIL_DB 配专用空目录 `mail-db-no-migrations`（只有 README），测试断言目录无 `.sql` 且配置指向它（执行者已在本地复现未配置时 `migrations list MAIL_DB` 列出的正是本项目 0001–0008）；误操作时 wrangler 仍会建空的 `d1_migrations` 表，文档给出确认计数为 0 后删除的方法；zod `jitless`（需动态导入 bootstrap 才生效）；`gen-headers` 7 个 node:test 用例。
- 主 agent 复跑（`4cb5adc`）：typecheck/lint 三包 Done；web 52 文件 459 用例 + node:test 7 通过；worker 75 文件 1557 用例通过；web build 生成 `_headers`（1 个内联哈希）；`wrangler.jsonc` MAIL_DB `migrations_dir` 为 `mail-db-no-migrations`，目录只含 README；deploy.md 的 `APP_SECRET` 写法已改。
- 安全验收实测（8813 + headless Chrome）：5 个页面安全头齐全，`/_headers` 不外泄；登录页 Turnstile 测试 key 渲染与外部请求不被 CSP 拦；HTML 邮件 srcdoc 与远程图片正常；CDP 虚拟认证器注册与登录通行密钥成功，`publickey-credentials-*` 与 `clipboard-write` 未被 Permissions-Policy 误伤；`/api/*` 各类响应带安全头。
- 遗留：只登记通行密钥未开 TOTP 的管理员可用单因素会话自行启用 TOTP 进入管理端（"谁能启用 TOTP"的老问题，非本次引入）；停用 OAuth 提供方与清除凭据不做防锁死检查（deploy.md 已写应急办法）；入口 chunk 拆分后首屏多一次顺序加载。

### 2026-11-20 M7b-2a 通过

- 执行：sonnet-5-5#high（`ses_e08a09aa1ffemg7HN0ROyfXMmw`）；验收：opus-5-5#high（`ses_e08946d2dfferdJm2VnMOsp8D7`），"有条件通过"，修复由主 agent 机械核对后合并。
- 过程：`fbd4cfb` 交付 → `ae84f03` 验收修复。只改 `apps/web/src/`。
- 内容：设置页 secret 框（原已 `new-password`/`off`，补测试）；Logo 读文件前按 `SITE_LOGO_MAX_LENGTH × 3/4` 预检、读后按长度复查；默认强调色可读性提示按 tokens 的 `accent-text` 计算（测试读 `tokens.css` 防漂移）；会话时长文案与客户端校验由 shared 常量生成，范围错误与 schema 错误合并返回；注册成功但取会话失败提示"账号已创建，请前往登录"；用户页"共 N 个用户"（占位数据/出错时不显示）；测试器不可见邮件显示管理员视角发件人/主题；`/inbox`"全部"详情与附件带列表项 `mailbox_id`（同一选中邮件首次解析后锁定）；用户表表头改两行，`.table th`（除 `.col-check`）超长省略。
- 验收首轮必修：切换筛选时 `keepPreviousData` 致页头短暂显示旧总数；注册后取会话失败分支缺测试（执行者首轮汇报称已补、实际未写入文件，修复轮补上，主 agent 已在文件中核对两条用例存在）。
- 主 agent 复跑（`ae84f03`）：typecheck/lint 三包 Done；web 54 文件 479 + node:test 7、worker 75 文件 1557 通过；web build 成功；看 `users-1440-fix.png` 表头不再重叠。
- 遗留：`register-created-390` 截图实为"用户名已被使用"表单（同布局，风险低）；`.table th` 截断规则合入 UI-5 后需看一眼链接表表头。

### 2026-11-20 UI-5 通过

- 执行：sonnet-5-5#high（`ses_e08e993e4ffe95V74xCD1eCriH`）；验收：opus-5-5#xhigh（`ses_e08a86aafffe8vwiuHxrf4hIIE`）首轮"有条件通过"，同会话 opus-5-5#high 复验"有条件通过"（仅表头小修，主 agent 核对后合并）。
- 过程：`6ca86ff` 交付 → `544e05e` 合入 UI-3/UI-4a/UI-4b（Turnstile 统一为 `TurnstileWidget`、收件地址页"生成取件链接"入口、取件页跳过 setup 守卫、`/s/$token` 区分大小写）→ `d488048` 合入 M7b-1 → `7286bab` 验收修复 → `3f1a5ab` 合入 M7b-2a → `2928cea` 表头小修。
- 内容：取件页状态机（`needs_start`/`active`/`device_limit`/`daily_limit`/`no_mailbox` 与 404/410/403/429 映射，未知错误码不冒充失效）、口令与 Turnstile 开始取码、`code_only` 验证码/登录链接卡片、列表+详情、`click` 取码与剩余次数、`next_after_id` 增量轮询与 partial 1/2/4 秒退避、无操作 5 分钟暂停、新邮件标题前缀；自有 fetch 层（401 不跳登录、保留错误体字段）；链接管理页表格/筛选/批量、侧板、创建向导（结果页一次性显示完整链接）、导出、复制链接前提示写审计；收件地址页"生成取件链接"（`create_for`，关闭即清 URL 与 sessionStorage）与"授权给用户"（`POST /api/admin/grants/batch`，复用 UI-4a 授权件，逐条结果）。后端仅 `device_limit` 状态加 `max_devices`。
- 首轮必修：仅每日次数用尽时误显示"次数已用完，请联系卖家"——改为显示恢复时间与"不是链接失效"，保留已取到的码并继续轮询；总次数用尽仍停止轮询。合并适配：删除第三份重复的 `listMailboxes`。复验必修：M7b-2a 的表头省略号规则把"24h 取码"截成"24h …"，改为"24h"+`title`。
- 取舍：取件页保留 `/api/public/config` 请求（外观 `appearance` 只由它提供，同源）；410/404 页无站点数据不显示品牌；行内操作只做复制链接与预览，其余在侧板（无下拉菜单组件）。
- 主 agent 复跑（`2928cea`）：typecheck/lint 三包 Done；web 63 文件 579 + node:test 7、worker 75 文件 1557 通过；web build 成功；截图核对链接表表头完整，执行者脚本确认所有 `th` 无截断。
- 实测（评审 8814 + headless Chrome 390×844）：口令前无地址、标题无 token、卖家说明 HTML 原样为文字；错误口令就地提示；click 取码剩余次数递减；第二上下文设备已满（"最多可在 1 台设备上使用"）；总次数用尽后 25 秒内 `/mails` 请求增量 0 且码保留；仅每日用尽码保留且继续轮询；撤销后两上下文均"已失效"；`/S/<token>` 为页面不存在；取件页对 `/api/setup/status` 与第三方请求数 0；Turnstile 仅 required 时加载、拿到 token 前禁用、Referer 为空；命中区全部 ≥44×44；HTML 详情 iframe sandbox 精确；2×2 批量授权全部成功、再次"跳过"全部 skipped、用户 `/inbox` 可见。
- 遗留：管理页窄屏（<1024）表格与侧板未专门看图；复制到剪贴板成功路径只靠单测（headless 权限拒绝）；Turnstile 真实挑战需部署后用正式 site key 冒烟；默认不过期的链接无法"延长"（提示目前没有截止时间）；授权用户选择器超过 50 人时靠搜索。

### 2026-11-20 M7b-2c 通过

- 执行：sonnet-5-5#medium（`ses_e087db956ffecqpqtHp1OlipPo`）；验收：opus-5-5#high（`ses_e0878b045ffeQ1T8QSPd6JBfAR`），"有条件通过"，修复由主 agent 核对后合并。
- 过程：`0f81e58` 交付 → `0ba1e0f` 验收修复。只改 `apps/web/src/`。
- 内容：标签筛选候选改用 `GET /api/admin/mailboxes/tags`（schema 校验、label 为"N 个地址"、`truncated` 提示、查询键在 `adminMailboxes` 下随写操作失效，失败时就地报错+重试）；"取件链接：全部/有/无"筛选映射 `has_link`，与跨页全选、批量层同一筛选；页头摘要分隔点改 `content: "·" / ""`（读屏名称"启用 N"）；窄列时间用 `formatCompactDateTime`（今年 `MM-DD HH:mm`，跨年只显示日期，`title` 为完整时间），用于收件地址表与链接表。
- 验收实测（8820 真实后端 + headless Chrome）：40 地址/18 有链接，候选 `OpenAI（25）、GitHub（10）、Apple（5）`，首屏只请求一次 `/tags`，翻页与切筛选不重取；有/无链接 18/22 行与接口一致，叠加标签一致；无链接下跨页全选"选择全部 22 项"请求带 `has_link=false`；有选中项时工具栏换为批量条，不能在已选状态下改筛选。
- 主 agent 复跑（`0ba1e0f`）：typecheck/lint 三包 Done；web 65 文件 589 + node:test 7、worker 75 文件 1557 通过；web build 成功。首次全量时 worker `ratelimit.test.ts`"按 IP 超限"偶发失败 1 次（单跑 8 次全过，与本线无关，疑为本地限流固定时间窗被跨越，另行修复）。
- 遗留：执行者两轮 Chrome 核对都用 vite + mock 后端（真实后端由验收实测补齐）；`/tags` 失败错误条未截图，窄屏下工具栏可能换行；datalist 下拉的实际观感需人工在 Chrome/Safari 看一眼。

### 2026-11-20 M7b-2b 通过（端到端测试）

- 执行：sonnet-5-5#high（`ses_e088a8e64ffezLMaPnWuSA0dk2`）；验收：opus-5-5#high（`ses_e0865b8cdffeO8x4GRCE8h032r`），"有条件通过"，修复与补覆盖由主 agent 核对后合并。
- 过程：`eb13472` 框架与 11 用例 → `eab40e1` 合入 UI-5/M7b-2a → `7c25ef1` 取件闭环、批量入口、种子脚本 `PERSIST_TO` → `38d0097` 合入 M7b-2c/FIX-RL → `87d0c24` 验收修复、补覆盖、认证请求预算。
- 内容：`apps/e2e`（Playwright Test + 本机 Chrome，`pnpm e2e`，不并入 `pnpm test`）；每次运行全新临时数据目录：构建前端 → 只对 APP_DB 迁移 → 种子脚本灌 MAIL_DB → `wrangler dev :8817`，密钥经临时 `--env-file`（不读写 `.dev.vars`），结束清理进程与目录；auto fixture 守卫每个上下文与弹窗的 CSP 违规、非本地请求、未捕获异常、`/api/*` 5xx（iframe 内 CSP 违规只能经控制台发现，09 自检与 README 如实说明）；依赖前序数据的文件开头前置检查、缺数据立即报错；认证请求预算：按 worker `RATE_LIMITED_ROUTES`（直接导入）归类、globalSetup 自检归类、globalTeardown 断言每个限流 key 整次运行 ≤ 上限−2（上限读 `wrangler.jsonc`）。
- 用例（25）：初始化；TOTP/恢复码（同一恢复码只能用一次）；通行密钥注册与登录；收件地址导入；规则组测试器；用户授权与 `/inbox`（`code_only` 无详情，越权 404）；管理员全部邮件 HTML sandbox 精确、无 tracker 请求；权限 401/403、CSRF/Origin、安全头与 CSP 与 `_headers` 一致；守卫自检；取件闭环（创建结果页唯一出现完整链接、口令前无地址、click 取码剩余递减、设备已满"最多 1 台"、总次数用尽停止轮询保留码、仅每日用尽保留码继续轮询、撤销后已失效无原因、页面开着时被暂停停止轮询、`/S/` 不存在、不请求 setup、`no-store`/`noindex`、完整视图 sandbox）；取件 `text`/`meta_only` 视图；收件地址页"生成取件链接"与"授权给用户"；管理员强制 2FA（防锁死 400、只有密码的管理员 403 `admin_2fa_required` 并被引导、TOTP 与通行密钥放行、收尾关回）。轮询相关断言用 `page.clock` 推进，计数前先落定网络并有正向对照。
- 验收：两个变异在副本中都被拦住——邮件 iframe sandbox 加 `allow-scripts` → 07 与 10 失败（18 通过）；用尽总次数后继续轮询 → 10"Expected 4 Received 5"。隔离与安全无问题（无 `--remote`、假密钥、`.auth/` 已忽略）。
- 预算实测：`login:ip` 原为 9 次（同一墙钟窗口可能偶发 429），02 合并登录后 8/8；`mfa`/`passkey`/`passkey-manage`/`reauth` 各 4/8，`setup` 2/8。
- 主 agent 复跑（`87d0c24`）：typecheck/lint 四包 Done；web 589 + node:test 7、worker 1557 通过；`pnpm e2e` 连跑 2 次 25 passed（43.5s/43.9s），8817 无残留；单独跑 `test/10` 135ms 快速失败并提示依赖。
- 未覆盖（README 已写明原因）：取件 Turnstile（测试 key 的 hostname 与 `PUBLIC_ORIGIN` 不符会被后端严格拒绝）、OAuth（需真实提供方）、partial 退避（本地无法稳定制造未解析完的邮件）；登录页没有"密码 + 通行密钥"第二步（通行密钥是独立登录入口），按实际行为测试。
- 注意：`login:ip` 已用满预算，新增登录类用例须复用会话。运行 `pnpm e2e` 需设 `TEMP_EMAIL_SCHEMA`。

### 2026-11-20 终验（fable-5-2#xhigh）

- 评审会话 `ses_e0847ba58ffeGGH4p74GNU0b7K`，对象 main `e44fb6a`（只读 worktree `final-review`，端口 8821）。结论：**有条件可以发布**，无代码级阻塞。
- 复跑：`pnpm e2e` 25 passed（52.0s）；typecheck/lint exit 0；web 589、worker 1557 通过；`wrangler deploy --dry-run` 通过（gzip 464 KiB，5 个 binding）。浏览器 1440/390 走通初始化 → 导入 → 规则组 → 建链接 → 买家取码 → 撤销，及用户授权与 `/inbox`。
- 安全实测（API 断言 209 过、6 未过：5 条为评审脚本预期错误已复核，1 条为邮件 id 复用）：越权读邮件、跨用户授权、token 猜测/大小写、规则绕过、口令锁定与设备/次数并发、410 五种原因响应逐字节相同、CSRF 各变体、会话固定、登录枚举（耗时 9.9/9.7 ms）与限流、约 40 个 XSS 向量、规则组配置损坏 503、审计/日志无 token/密码——均通过。
- 发布前置条件（需用户）：每个在售平台用真实邮件验证规则（模板 A 的 L2 关键词分类在 13 封高危样本中漏判 3 封；共享号/高价值号用 L3 主题白名单）；完成生产冒烟；启用 OAuth 前先修 OAuth 绑定（FIN-A）或开启"OAuth 后仍需两步验证"。
- 应尽快修复（已分派）：OAuth 绑定可被跨站发起（FIN-A）；邮件 id 复用后取码记录误判（FIN-A）；站点 Logo/描述/页脚不显示（FIN-B）；13 个已登录 GET 缺 `no-store`（FIN-A）；只读守卫只扫 `mail-source/`（FIN-A）；高危词表缺措辞与语言（FIN-C）；登录失败审计刷量增长（FIN-C 文档建议）；390 宽管理表格不可读、`auto` 链接"24h"恒 0（FIN-B）。另：导入列序与 06 §8 不符（FIN-C）；规则组编辑页无 `<h1>`（FIN-B）；部署文档缺若干冒烟项与自救办法（FIN-C）。
- 设计覆盖：01–06 主体均已实现；按设计留二期：`mailboxes/discover`、API 令牌、高危邮件提醒、发件人 SPF/DKIM 校验；按裁定取消：drizzle。未实测：OAuth 全流程、Turnstile 真实挑战、partial 退避、生产 PBKDF2 与限流。
- 产物：`/private/var/folders/2r/l2vqrhns69bd3pr0hltlzyn80000gn/T/opencode/final-review/`（81 张截图、脚本、`e2e.log`、`api-attack.log`、`browser-walk.log`）。
