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
  - 登录页 Turnstile（05 §3"开启人机验证时带 Turnstile"）：UI-4a 未接、UI-4b 按分工不碰登录页。合并顺序改为 UI-4b 先合入 main（已验收通过），UI-4a 修复时合入 main 后用 UI-4b 的 `TurnstileWidget` 给自己的登录页密码表单带上 `turnstile_token`（action `login`）。**发布阻塞项**：接好之前，管理员若在设置页把 login 加入验证范围，所有密码登录都会失败；最终验收前必须完成。
  - 设了口令的链接，访客通过口令前 `GET /api/s/:token` 不返回收件地址（卖号场景里收件地址就是登录邮箱，口令要连账号身份一起挡住）。
  - 附件下载写 `download` 日志是"GET 无副作用"的唯一例外：要求已登记访客 Cookie，预览机器人在写入前就被 401 挡住，且不改变激活、设备、计次。
  - M3b-2 修复时的取舍（已接受）：迁移 0006 新增表 `link_password_attempts`（IPv6 按 /64 合并计数，访问日志里的完整 IP 文本无法按网段比较），过期行由 M7b 的每日 cron 清理；新增 HKDF 用途 `linkVisitorCookie`（不让 AES-GCM 加密密钥跨算法使用）；导出行模板完全不做公式中和（输出是贴进发卡平台的纯文本，只中和行首也会改坏 `-foo@x.com`），CSV 模式照常中和；按链接的口令全局上限（15 分钟 20 次）是可被利用的锁，阈值可调。
  - 取件链接 M3b-2 的取舍（已接受）：总次数用尽在限流之后、访客 Cookie 之前判定（对外等同"已失效"，与访客无关）；IP/国家被拒归入"已失效"；拒绝日志只在 POST 上写，GET 不写（避免预览机器人与轮询刷日志）；访客 Cookie 名 `mlv_<链接id>`；撤销为终态；`access/tester.ts` 加可选 `anchors` 让管理员预览复用测试器。
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
| UI-3 | 收件地址页、规则组列表与编辑（含测试器）、全部邮件 HTML 接线与"以此邮件创建规则"、审计日志页 | sonnet-5-5#high | 修复中（验收"有条件通过"：JSON 模式语法错误时仍可保存上一份配置且离开不提示、两处写死的 maxLength（名称 200 与接口上限 64 不一致）；评审会话 `ses_e08e75a70ffe4crGQeP5OJz5F9`；交付 `a8bdc25`，已合入最新 main 为 `d06dbe2`） | 执行会话 `ses_e09313850ffe7INAHx6EaIz0kU` |
| UI-4a | 登录两步验证/通行密钥/OAuth、账号安全（2FA、恢复码、通行密钥、第三方账号）、用户侧板凭据清除与授权块、我的邮件 `/inbox` | sonnet-5-5#high | 待修复（验收"有条件通过"：启用/关闭 2FA 后未刷新会话缓存致 `admin_2fa_required` 引导残留；并入错误标题、`/account?oauth` 读完即清、恢复码阶段单主按钮、侧板清自身 2FA 刷新会话；评审会话 `ses_e08e3735fffeR02OJ3c0riBLei`；`68d3150`；排队等开发线名额） | 执行会话 `ses_e091cec86ffeMdruzBXfSfQbgA` |
| UI-4b | 系统设置页（含外观实时预览、OAuth 提供方管理）、注册页、前端强调色算法切到 shared `theme-contrast` | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 UI-4b |
| UI-5 | 取件链接管理页、取件页 `/s/:token`（两种视图与全部状态）、收件地址页的"生成取件链接/授权给用户"批量入口 | sonnet-5-5#high | 进行中（worktree `ui5-links-pickup`，分支 `ui5`，基于 `6a0b86e`，端口 8808；Turnstile 先本地最小实现，合并时改用 UI-4b 的 `TurnstileWidget`） | 执行会话 `ses_e08e993e4ffe95V74xCD1eCriH` |
| M7a | 审计日志列表、cron（预热 mail_index、每日清理）、限流基础设施 | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 M7a |
| INT-1 | M3b-2 × M6 集成：链接允许 Turnstile、"开始取码"接入 Turnstile、`GET /api/s/:token` 带出品牌/公告/data URI Logo/site key、创建链接用默认值、cron 清理 `link_password_attempts` 与 `auth_flow_tokens` | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 INT-1 |
| M7b-1 | 安全加固（页面 `_headers` 构建时生成含内联脚本哈希的 CSP、API 安全头、管理员强制 2FA 口径收紧）、后端缺口（收件箱列表 `mailbox_id`/`view`、标签清单、有无链接筛选与计数、测试器不可见邮件发件人主题、`draft-from-mail` schema、公开配置 `password_min_length`、用户列表 `total`）、`docs/deploy.md` | opus-5-5#high（含安全加固，按复杂任务） | 进行中（worktree `m7b1-hardening-gaps-deploy`，分支 `m7b1`，基于 `6a0b86e`，端口 8812，迁移号 0010） | 执行会话 `ses_e08e1db45ffe0KGf6OaDUOE0g9` |
| M7b-2 | 端到端测试（真实浏览器走核心闭环与关键安全路径） | sonnet-5-5#high | 待办（等前端各页合并） | |
| 终验 | 整体验收 | fable-5-2#xhigh | 待办 | |

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
- 待 M7b-2 收尾的小项：两个 secret 输入框 `autoComplete` 改 `off`；Logo 读文件前先按 `file.size` 粗筛；默认强调色时可读性提示与 `tokens.css` 的 `accent-text` 值不一致；会话时长提示文案用 shared 常量；注册成功但取会话失败时提示"账号已创建，请去登录"。
