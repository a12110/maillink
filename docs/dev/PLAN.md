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
| M3b-1 | 取件流水线（access）、收件地址 API、规则组 API（含测试器与草稿）、setup 写模板、管理员邮件 HTML、M3a 遗留加固 | opus-5-5#high（集成核心，按复杂任务升级） | 进行中（worktree `m3b1-pipeline-mailboxes`，分支 `m3b1`，基于 `5b33f97`，端口 8797，迁移号 0004） | 执行会话 `ses_e0a269005ffeXXMzyWYgGFPNQw` |
| M3b-2 | 取件链接管理 API 与公开取件接口 `/api/s/:token/*`（访问约束、设备、取码计次、预览、日志、导出） | opus-5-5#high | 待办（等 M3b-1 合并；迁移号 0006） | |
| M4 | 用户授权、用户收件箱 | sonnet-5-5#high | 待办（等 M3b-1 合并，可与 M3b-2 并发；迁移号 0007） | |
| M5 | TOTP、Passkey、OAuth2/OIDC（后端），批量注销会话，公开配置登录方式 | opus-5-5#xhigh | 进行中（worktree `m5-mfa-passkey-oauth`，分支 `m5`，基于 `5b33f97`，端口 8798，迁移号 0005；与 M3 无关，并发） | 执行会话 `ses_e0a26007fffe162XUPKIsWf9PB` |
| M6 | 系统设置、外观、注册、Turnstile | sonnet-5-5#high | 待办 | |
| UI-1 | 前端基础（令牌接入、主题运行时、API 客户端、路由守卫）、三套外壳、`/setup` `/login` `/admin/users` `/account` | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 UI-1 |
| UI-2 | `/admin/mails`（队列 + 详情、筛选、partial 退避重取、原文与邮件头）与可复用邮件组件（`MailHtmlFrame` 等） | sonnet-5-5#high | 通过，已合并（HTML 正文字段待 M3b-1 合并后接线） | 见记录 2026-11-20 UI-2 |
| UI-3+ | 收件地址、规则组编辑与测试器、取件链接、取件页、我的邮件、账号安全的 2FA/通行密钥/第三方账号、系统设置（随后端推进） | sonnet-5-5#high | 待办 | |
| M7 | 审计、cron、限流、加固 | sonnet-5-5#high | 待办 | |
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
