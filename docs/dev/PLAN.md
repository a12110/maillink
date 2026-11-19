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

## 里程碑

状态：待办 / 进行中 / 待验收 / 通过 / 退回

| 阶段 | 内容 | 执行模型 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| M0 | 脚手架、两个 D1、迁移、健康检查、本地种子 | sonnet-5-5 | 通过 | 见记录 2026-11-20 M0 |
| UI-0 | `DESIGN.md`、设计变量、三个代表页的静态原型（与 M0 并发） | sonnet-5-5#high | 进行中 | |
| M1 | 初始化、账号密码登录、会话、用户与角色 | sonnet-5-5#high | 待办 | |
| M2 | mail-source / 解析 / mail_index、管理员全部邮件 | sonnet-5-5#high | 待办 | |
| M3a | 规则引擎（schema、求值、trace、分类、提取、呈现） | opus-5-5#xhigh | 待办 | |
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
- 遗留改进（并入 M1 处理）：只读守卫漏掉 `REPLACE INTO` / `PRAGMA x=` / `VACUUM` 且误报 `cache.delete`，去注释函数未单测；探测抛异常时未清缓存；`ZodError` 全局映射为 400；健康检查异常未打日志；`.gitignore` 补 `.env*`；ESLint 缺 `complexity: 10`；`engines` 应为 `>=22.18`；种子缺带 `metadata.ai_extract` 的样本（M2 处理）。
