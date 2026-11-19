# 取件链接系统 设计文档（v0.1 草案）

更新：2026-11-19 ｜ 状态：待评审 ｜ 暂名：MailLink（可改）

基于 `cloudflare_temp_email`（fork，v1.15.0，DB_VERSION `v0.0.11`）的邮件数据库，做一个部署在 Cloudflare Workers 上的"链接取邮件"系统：管理员导入 iCloud 隐私邮箱（Hide My Email）地址，配规则组，生成取件链接发给别人；别人打开链接只能看到规则允许的邮件。

## 文档索引

| 文件 | 内容 |
| --- | --- |
| `README.md` | 目标、术语、关键决策、里程碑、待确认项、风险 |
| `01-architecture-and-data.md` | 架构、部署、邮件库读取契约、自有库表结构 |
| `02-rule-engine.md` | **规则组设计（重点）**：过滤、时间、呈现、访问约束、求值与测试 |
| `03-auth-users-settings.md` | 登录（密码 / 2FA / WebAuthn / OAuth2-OIDC）、用户管理、系统设置 |
| `04-api.md` | API 路由清单与约定 |
| `05-ui.md` | 页面地图、各页骨架、oil-ui-pro 交接说明 |
| `06-scenario-account-resale.md` | 主要使用场景"卖号取码"：模板、平台预设、链接生命周期、边界情况 |

## 1. 目标与范围

**要做的**

1. 单个 Worker 部署：API + 前端静态资源同源。
2. 两个 D1：`MAIL_DB`（cloudflare_temp_email 的库，**只读**）+ `APP_DB`（本项目自有数据）。
3. 登录：账号密码、TOTP 2FA、WebAuthn/Passkey、通用 OAuth2/OIDC 客户端。
4. 管理端：收件地址导入与管理、规则组、取件链接、用户授权、全部邮件、用户管理、系统设置。
5. 取件链接公开页：凭链接查看经规则过滤后的邮件列表与详情。
6. 普通用户：登录后查看被授权邮箱的邮件。

**不做的（本期）**

- 不收信、不发信、不改 `MAIL_DB` 里的任何数据（收信仍由 cloudflare_temp_email 负责）。
- 普通用户不能自己创建取件链接、不能自己导入地址。
- 不做邮件全文检索、不做 Telegram/Webhook 推送、不做多租户。
- 不做邮箱注册验证（本项目没有发信能力）。

## 2. 术语

| 术语 | 含义 |
| --- | --- |
| 收件地址（mailbox） | 管理员导入的地址，通常是 iCloud 隐私邮箱别名，对应 `raw_mails.to_address` |
| 规则组（rule group） | 一组可复用的规则：时间窗 + 过滤（黑白名单）+ 呈现（视图/脱敏）。原需求里的"权限组"按同一个东西处理 |
| 取件链接（share link） | 一个不可猜的 token，绑定 1..N 个收件地址 + 1 个规则组 + 访问约束 |
| 授权（grant） | 用户 × 收件地址 × 规则组（可空 = 完整访问） |
| 主体（subject） | 一次邮件访问的发起方：链接 / 用户 / 管理员 |
| 邮件事实（mail facts） | 从原始 MIME 解析出的、供规则判定的字段集合，缓存在 `APP_DB.mail_index` |

## 3. 关键决策

| # | 决策 | 理由 |
| --- | --- | --- |
| K1 | 单 Worker + Static Assets，Hono + TypeScript | 同源，Cookie 会话简单；与 temp_email 后端技术一致 |
| K2 | `MAIL_DB` 以第二个 D1 binding 直连，代码层只读 | 最简单、最快；要求两个项目在同一个 Cloudflare 账号 |
| K3 | 按 `to_address` 匹配收件地址 | fork 已把 iCloud 别名解析进该列（`db/2026-08-02-to-address.sql`） |
| K4 | 邮件必须在**服务端**解析、过滤、脱敏后再下发 | temp_email 是把 raw 发给前端解析；这里规则要隐藏内容，raw 不能出服务端 |
| K5 | 解析结果缓存到 `APP_DB.mail_index`，懒构建 + cron 预热 | 避免每次列表都解 MIME；规则变了不用重新解析 |
| K6 | 链接与用户授权共用同一条"作用域 → 候选 → 规则 → 呈现"流水线 | 一套规则引擎，两种入口，行为一致 |
| K7 | 规则引擎与顺序无关：deny 优先，白名单/黑名单模式显式声明 | 管理员容易理解；全程失败关闭（fail closed） |
| K8 | 一个链接/授权只挂一个规则组 | 避免多规则组合并语义不清；要变体就克隆规则组 |
| K9 | 链接 token 存 SHA-256 哈希（查找）+ AES-GCM 密文（可再次复制） | 库泄露不等于链接泄露，同时保留"复制链接/批量导出" |
| K10 | 服务端会话（Cookie + `sessions` 表），不用 JWT | 管理员需要能强制下线、清绑定后立即失效 |
| K11 | 时间一律按 `raw_mails.created_at`（入库时间，UTC） | `Date` 头可伪造 |
| K12 | HTML 邮件用 HTMLRewriter 清洗 + 无脚本 sandbox iframe + CSP 三层 | Workers 没有 DOM，不能用 DOMPurify |

## 4. 总体架构

```
浏览器 ──► Worker (Hono)
            ├─ /api/public, /api/auth      公开与登录
            ├─ /api/s/:token/*             取件链接（主体=链接）
            ├─ /api/me/*                   普通用户（主体=用户）
            ├─ /api/admin/*                管理员
            └─ 其余路径 → ASSETS（SPA）
                 │
   access.resolveScope(主体) → { mailboxes, policy, 锚点时间 }
                 │
   mail-source（唯一读 MAIL_DB）→ mail-index（APP_DB 缓存）→ rules（纯函数）→ render（清洗/脱敏）
                 │                         │
              MAIL_DB (D1, 只读)        APP_DB (D1)
```

## 5. 里程碑

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| M0 | monorepo 脚手架、wrangler、两个 D1、迁移、健康检查（探测 MAIL_DB 表结构）、本地种子数据 | `wrangler dev` 起得来，健康检查返回 schema 信息 |
| UI-0 | 用 oil-ui-pro 画页面地图、锁导航外壳、做 2–3 个代表页，**确认视觉方向**后写 `DESIGN.md` | 见 `05-ui.md` |
| M1 | 首次初始化、账号密码登录、会话、用户与角色 CRUD | 管理员可登录、建用户 |
| M2 | mail-source / 解析 / mail_index、管理员"全部邮件" | 能看 gzip 与非 gzip 邮件，HME 发件人正确 |
| M3 | 收件地址导入、规则引擎、规则测试器、取件链接与公开页 | **核心闭环**：导入 → 配规则 → 生成链接 → 他人取件 |
| M4 | 用户授权、用户收件箱 | 用户只能看到授权邮箱且受规则约束 |
| M5 | TOTP、Passkey、通用 OAuth2/OIDC、账号安全页 | 三种登录方式 + 管理员清绑定 |
| M6 | 系统设置、外观主题、注册开关、Turnstile | 设置即时生效 |
| M7 | 审计日志、cron 清理、限流、e2e、部署文档 | — |

## 6. 待你确认的决策（均已给默认值，不确认就按默认做）

| # | 问题 | 默认 | 备选 |
| --- | --- | --- | --- |
| D1 | 前端技术栈 | React 19 + Vite + Tailwind v4 + Radix（shadcn 式自有组件）+ TanStack Router/Query | Vue 3 + Reka UI（与 temp_email 同栈） |
| D2 | Workers 套餐 | **Workers Paid**（解析 MIME 与密码哈希会超过 Free 的 10ms CPU） | Free：只能靠 cron 预解析 + 极小页，不推荐 |
| D3 | 两个项目是否同一 Cloudflare 账号 | 是（D1 binding 的前提） | 否 → 需改走 temp_email 的 admin HTTP API，设计要变 |
| D4 | 管理员能否在本系统删除邮件 | 否，`MAIL_DB` 严格只读 | 加开关 `MAIL_DB_ALLOW_DELETE` |
| D5 | 界面语言 | 中文为主，代码里保留 i18n 结构，英文后补 | 仅中文 |
| D6 | 链接是否允许多个收件地址 | 允许，上限 50；批量生成默认"一址一链" | 只允许一址一链 |
| D7 | OAuth 登录后是否还要本地 2FA | 不要（信任 IdP），可在设置里改 | 一律要求 |
| D8 | 项目/产品名 | MailLink | — |
| D9 | 是否需要 API 令牌，让发卡平台或自建商城下单时自动建链接 | 二期再做，一期用批量生成 + 按模板导出 | 一期就做 |
| D10 | 平台预设放哪些平台 | OpenAI、Anthropic、Google、Apple、Microsoft、Netflix、Steam、Discord、Spotify | 按你实际在卖的平台调整 |

## 7. 风险与已知限制

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| `to_address` 迁移前的旧邮件该列为 NULL | 旧的 iCloud 转发邮件按别名查不到 | 文档说明；如需要可在 temp_email 侧写一次性回填脚本（不在本项目内） |
| `raw_mails.id` 没有 AUTOINCREMENT，删最大行后 id 会被复用 | 缓存错配：旧邮件的解析结果套到新邮件上 | `mail_index` 存 `message_id` + `created_at`，命中时比对，不一致就重建 |
| temp_email 升级后表结构变化 | 查询失败 | 所有 MAIL_DB SQL 集中在 `mail-source`；启动/健康检查用 `PRAGMA table_info` 探测，缺列显式报错或降级为已声明的兼容路径 |
| HTML 清洗无 DOM | XSS、追踪像素 | 三层防护；配置了脱敏规则时禁止 HTML 视图 |
| 正则规则 ReDoS | 单次请求 CPU 打满 | 仅管理员可写；限制模式长度与输入长度；保存时校验 |
| 验证码提取是启发式 | `code_only` 视图可能漏掉邮件 | 测试器展示提取结果；规则组可自定义提取正则 |
| temp_email 的清理任务删邮件 | 链接里邮件变少 | 预期行为；cron 同步清理 `mail_index` |
| PBKDF2 在 Workers 的迭代上限（印象是 100,000，**实现时复核**） | 哈希强度受限 | 加 pepper；复核后再定参数 |

平台限制（2026-11-19 核对官方文档）：D1 单行/BLOB 上限 2 MB、每条查询最多 100 个绑定参数、`LIKE` 模式最长 50 字节、单次查询结果上限 50 MB；每次调用的 D1 查询数 Free 50 / Paid 1000；CPU 时间 Free 10 ms / Paid 默认 30 s。
