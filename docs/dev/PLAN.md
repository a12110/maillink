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

## 里程碑

状态：待办 / 进行中 / 待验收 / 通过 / 退回

| 阶段 | 内容 | 执行模型 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| M0 | 脚手架、两个 D1、迁移、健康检查、本地种子 | sonnet-5-5 | 通过 | 见记录 2026-11-20 M0 |
| UI-0 | `DESIGN.md`、设计变量、三个代表页的静态原型（与 M0 并发） | sonnet-5-5#high | 通过 | 见记录 2026-11-20 UI-0 |
| M1 | 初始化、账号密码登录、会话、用户与角色（后端）；含 M0 遗留修复 | sonnet-5-5#high | 通过，已合并 | 见记录 2026-11-20 M1 |
| M2 | mail-source / 解析（含内置验证码提取与 `category` 分类）/ mail_index、管理员全部邮件 | sonnet-5-5#high | 进行中（worktree `m2-mail-source`，分支 `m2`，基于 `1bb834b`，端口 8793，迁移号 0003） | |
| M3a | 规则引擎纯函数：schema 与保存校验、求值与 trace、时间下界、规则组级提取、呈现与 HTML 清洗、模板与预设、规则草稿 | opus-5-5#xhigh | 进行中（worktree `m3a-rule-engine`，分支 `m3a`，与 M1/M2 并发） | |
| M3b | 收件地址、规则组、取件链接 API 与公开接口 | sonnet-5-5#high | 待办 | |
| M4 | 用户授权、用户收件箱 | sonnet-5-5#high | 待办 | |
| M5 | TOTP、Passkey、OAuth2/OIDC | opus-5-5#xhigh | 待办 | |
| M6 | 系统设置、外观、注册、Turnstile | sonnet-5-5#high | 待办 | |
| UI | 前端各页面（随后端里程碑推进） | sonnet-5-5#high | 待办 | |
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
