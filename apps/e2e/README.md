# e2e：端到端测试

用真实的 Google Chrome（Playwright，`channel: "chrome"`）加一个本地 `wrangler dev`，走核心流程与关键安全路径。只用本地模式，不连接 Cloudflare。

## 怎么跑

前提：已 `pnpm install`（装依赖时不会下载浏览器，设 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 可显式跳过）；本机装有 Google Chrome；端口 **8817** 空闲。

```sh
# 必填：cloudflare_temp_email 的 schema.sql，用来给本地 MAIL_DB 建表（未设置会直接报错退出，不会跳过）
export TEMP_EMAIL_SCHEMA=/Users/a12110/Code/TS/cloudflare_temp_email/db/schema.sql

pnpm e2e                        # 仓库根目录；等价于 pnpm --filter e2e e2e
pnpm e2e test/05                # 只跑某个文件（初始化用例会先自动跑，见下）
pnpm e2e --headed               # 看着浏览器跑
pnpm --filter e2e exec playwright show-report   # 打开上次的 HTML 报告
```

`pnpm e2e` **不属于** `pnpm test`：单元测试有 60 秒上限、不依赖浏览器；e2e 要构建前端、起服务、开浏览器，单独跑。完整一轮约 20–30 秒（含约 15 秒的构建与启动）。

## 每次运行做什么

Playwright 的 `webServer` 执行 `scripts/serve.ts`，依次：

1. 在系统临时目录建一个全新的数据目录 `maillink-e2e-*`（本次运行独占，结束时删除；`E2E_KEEP_DATA=1` 可保留，路径会打印出来）；
2. `pnpm --filter web build`（Worker 的静态资源指向 `apps/web/dist`）；
3. 只对 **APP_DB** 应用迁移（`wrangler d1 migrations apply APP_DB --local --persist-to <目录>`）；
4. 用 `apps/worker/scripts/seed-mail-db.ts` 给本地 MAIL_DB 灌种子。该脚本把 wrangler 参数写死、没有 `--persist-to` 入口，所以经 `scripts/persist-to-hook.ts`（`node --import`）包一层，只允许它执行 `wrangler d1 execute MAIL_DB --local`，并追加 `--persist-to`；
5. `wrangler dev --port 8817 --persist-to <目录> --env-file <目录>/e2e.env --var PUBLIC_ORIGIN:http://localhost:8817`。

`APP_SECRET` / `SETUP_TOKEN` 是 `support/env.ts` 里的测试专用假值，写进临时目录里的 `e2e.env`。用 `--env-file` 而不是只靠 `--var`：wrangler 里 `apps/worker/.dev.vars` 的优先级**高于** `--var`，传了 `--env-file` 后才不会读它。所以本机有没有 `.dev.vars`、里面是什么，都不影响 e2e，e2e 也不会读写它。

收尾由 Playwright 向服务进程发 SIGTERM，`serve.ts` 停掉 wrangler（workerd 随之退出）并删除临时目录。如果是强杀（SIGKILL）导致残留，手动结束 `ps -ax | grep "port 8817"` 里的进程。服务端日志在临时目录的 `server.log`（保留数据时可看）。

## 结构

```
playwright.config.ts   单 worker 串行；setup 项目（初始化）→ flows 项目（其余用例）
scripts/serve.ts       构建 → 迁移 → 种子 → wrangler dev
scripts/persist-to-hook.ts
support/
  env.ts               端口、来源、测试用 APP_SECRET / SETUP_TOKEN
  accounts.ts          管理员账号、管理员会话文件（.auth/admin.json）、普通用户账号
  fixtures.ts          带全局断言的 test：violations（auto）、openContext、adminApi
  guard.ts             全局断言的监听实现
  actions.ts           登录、退出、API 建用户
  data.ts              种子地址、等待邮件索引解析完
  totp.ts              RFC 6238（node:crypto）
test/                  用例，按序号执行
```

## 用例

用例共用同一份临时数据，**按文件序号依次执行**，后面的依赖前面创建的数据；`01` 属于 `setup` 项目，其余用例通过项目依赖总会先跑它（它创建管理员并把会话存到 `.auth/admin.json`）。

| 文件 | 内容 |
| --- | --- |
| `01-setup` | 用 SETUP_TOKEN 走 `/setup` 创建管理员（含错误令牌）→ 登录 → 进入管理端 |
| `02-two-factor` | 启用 TOTP（页面取密钥、本地算验证码）→ 保存恢复码 → 密码 + TOTP 登录 → 恢复码登录一次 → 同一恢复码再用被拒 |
| `03-passkey` | CDP 虚拟认证器注册通行密钥 → 退出 → 通行密钥登录 |
| `04-mailboxes` | 两步对话框导入种子地址（含重复与无效行），列表与计数 |
| `05-rule-groups` | 新建「仅验证码」规则组，测试器对种子邮件给出可见 / 不可见 |
| `06-users-grants` | 新建普通用户，授权 1 个地址 + 规则组；该用户 `/inbox` 只看到验证码卡片、无详情 |
| `07-admin-mails` | 全部邮件里的 HTML 邮件：iframe `sandbox` 精确匹配、不发远程图片请求 |
| `08-security` | 未登录 401、普通用户 403 与页面被挡、CSRF 头与 Origin、`/api/*` 安全头、页面 CSP 与 `dist/_headers` 一致 |
| `09-guard-selfcheck` | 全局断言自检：故意制造违规，确认守卫会记录 |

## 全局断言

`support/fixtures.ts` 里的 `violations` 是 auto fixture，每个用例都生效；用例结束时断言它为空。每个浏览器上下文（含 `openContext()` 打开的、弹窗和 iframe）都被监听：

- CSP 违规：`securitypolicyviolation` 事件与控制台里的 CSP 报错；
- 对非 `http://localhost:8817` 的任何请求；
- 未捕获异常（`weberror`）；
- `/api/*` 返回 5xx。

预期内的 4xx（如未登录时 `/api/auth/session` 的 401）不算失败。

## 写用例时注意

- **限流**：登录 / 初始化 / 两步验证等接口每个 IP 每分钟 10 次（同一 IP 的所有用例共享）。不需要测登录的用例用 `test.use({ storageState: ADMIN_STATE })` 复用会话，不要反复登录；需要独立状态的用例用 `userAccount("名字")` 建自己的用户。
- **TOTP 防重放**：同一个 30 秒时间步的验证码只能用一次。启用时用掉当前步，之后登录用下一步的码（服务端容忍前后各一步），见 `02-two-factor`。
- **等待**：不用 `sleep` / `waitForTimeout`，用 Playwright 的自动等待与 `expect.poll`。邮件按需解析，涉及邮件内容的用例开头调用 `warmMailIndex` 等到全部解析完。
- `openContext()` 默认给空会话（`test.use({ storageState })` 不会泄漏进去）。
