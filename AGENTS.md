# AGENTS.md

本仓库是"取件链接系统"（暂名 MailLink）：部署在 Cloudflare Workers 上，读取 cloudflare_temp_email 的 D1 邮件库，按规则组生成取件链接。

## 必读

- 设计文档在 `docs/design/`，从 `docs/design/README.md` 读起。实现与设计冲突时以设计文档为准；发现设计有误，在交付说明里指出，不要自行改设计文档。
- 进度台账在 `docs/dev/PLAN.md`，由主 agent 维护，子 agent 不改。
- 参考项目（只读，不要修改）：`/Users/a12110/Code/TS/cloudflare_temp_email`。

## 结构

- `apps/worker/`：Cloudflare Worker，Hono + TypeScript。唯一查询 `MAIL_DB` 的目录是 `apps/worker/src/mail-source/`（其他目录只能把句柄原样交给它，见硬性规则）。
- `apps/web/`：前端 SPA，React 19 + Vite + Tailwind v4 + Radix + TanStack Router/Query。
- `packages/shared/`：zod schema 与 API 类型，前后端共用。
- 包管理用 pnpm workspace。

## 硬性规则

- `MAIL_DB` 只读：`mail-source` 里不得出现 `INSERT/UPDATE/DELETE/ALTER/DROP/CREATE`；`mail-source` 之外只能把 `env.MAIL_DB` 直接作为实参传给从 `mail-source/` 导入的函数（类型 `MailDbBinding`），不得展开 env、用计算属性取它或转交给其他函数（worker 测试中的守卫会检查）；迁移只针对 `APP_DB`，`wrangler.jsonc` 里 MAIL_DB 的 `migrations_dir` 指向必须保持为空的 `mail-db-no-migrations/`。
- 所有 SQL 参数化；外部输入在路由边界用 zod 校验。
- 不把密钥写进源码；本地用 `.dev.vars`（已忽略），示例放 `.dev.vars.example`。
- Debug-First：不加静默降级、假成功、吞异常的 fallback；失败要暴露。
- 规则与邮件访问一律失败关闭（fail closed），见 `docs/design/02-rule-engine.md` §5。
- 不部署、不调用真实 Cloudflare 账号；只做本地开发与测试（`wrangler dev` 本地模式、本地 D1）。

## 代码约定

- 函数 ≤ 70 行、文件 ≤ 500 行、嵌套 ≤ 5 层；上限与默认值集中在 `apps/worker/src/constants.ts`，不写 magic number。
- 标识符英文，注释优先中文，只在行为不明显处写注释。
- ESM、严格 TypeScript（`strict: true`），不用 `any` 逃避类型。
- KISS / YAGNI：只实现当前任务要求的内容，不预建后续里程碑的代码。

## 命令（在仓库根目录）

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm lint` | 全仓 lint |
| `pnpm test` | 全仓单元测试（单个测试 60 秒超时） |
| `pnpm --filter worker dev` | 本地起 Worker |
| `pnpm --filter web dev` / `build` | 前端开发 / 构建 |

## 并发开发

可能有其他子 agent 同时在别的 worktree 里开发。

- 只改派发说明里划给你的目录和文件。
- 根 `package.json`、`pnpm-lock.yaml`、`packages/shared/`、`apps/worker/src/constants.ts`、`apps/worker/migrations/` 是共享文件，派发说明没有明确交给你时不改；确实需要改的，在汇报里写明要改什么、为什么。
- 新建迁移文件只用派发说明分配给你的编号。
- 起 `wrangler dev` 时用派发说明给你的端口（没给就用 8787）；收尾只结束你自己启动的进程（记下 PID 再 `kill`），不要用 `pkill -f workerd` 这类会误伤其他 worktree 的命令。

## 交付

每个任务结束时给出：做了什么、关键文件路径、实际运行过的验证命令及其输出（原样粘贴结尾部分）、没做完或有风险的地方。命令没真正跑过就不要说通过。不要 `git commit`，提交由主 agent 在验收后完成。
