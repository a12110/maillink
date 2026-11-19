# 04 API

## 约定

- 前缀 `/api`，JSON。请求体与查询参数用 zod 在边界校验（schema 来自 `packages/shared`）。
- 错误统一：`{ "error": { "code": "snake_case", "message": "给人看的话" } }` + 合适的 HTTP 状态码。未预期的异常由全局处理器记录并返回 500，不在各处吞掉。
- 列表统一：`{ "items": [...], "next_cursor": "..." | null }`；邮件列表另有 `partial: boolean`（见 01 §4.2）。
- 鉴权：会话 Cookie。`/api/admin/*` 需 `admin`；`/api/me/*` 需登录；`/api/s/:token/*` 用链接 token（外加可能的访客 Cookie）。
- 写操作需通过 CSRF 检查。
- 邮件相关响应一律 `Cache-Control: no-store`。

## 公开

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/public/config` | 站点名称、外观、是否开放注册、Turnstile site key、可用登录方式与 OAuth 提供方 |
| GET | `/api/setup/status` | 是否需要初始化 |
| POST | `/api/setup` | 创建首个管理员，需 `SETUP_TOKEN` |

## 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | 用户名密码。返回 `ok` 或 `mfa_required` |
| POST | `/api/auth/mfa/totp` | 提交 TOTP |
| POST | `/api/auth/mfa/recovery` | 提交恢复码 |
| POST | `/api/auth/passkey/options` | 取通行密钥登录的 challenge |
| POST | `/api/auth/passkey/verify` | 校验断言并登录 |
| GET | `/api/auth/oauth/:slug/start` | `?mode=login` 或 `link`，302 到提供方 |
| GET | `/api/auth/oauth/:slug/callback` | 回调，完成后 302 回前端 |
| POST | `/api/auth/register` | 注册（开关关闭时 404） |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/session` | 当前用户与角色 |

## 当前用户

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / PATCH | `/api/me` | 资料 |
| POST | `/api/me/password` | 改密码（需旧密码） |
| POST | `/api/me/totp/setup` → `/enable`；DELETE `/api/me/totp` | 2FA |
| POST | `/api/me/recovery-codes` | 重新生成 |
| GET / POST / PATCH / DELETE | `/api/me/passkeys[...]` | 列表、注册（options + verify）、改名、删除 |
| GET / DELETE | `/api/me/identities[/:id]` | OAuth 绑定 |
| GET / DELETE | `/api/me/sessions[/:id]` | 会话 |
| GET | `/api/me/mailboxes` | 被授权的收件地址 |
| GET | `/api/me/mails` | `mailbox_id`（可选）、`cursor`、`after_id` |
| GET | `/api/me/mails/:id` | 详情 |
| GET | `/api/me/mails/:id/attachments/:index` | 附件 |

## 取件链接（公开页）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/s/:token` | 链接状态与页面所需信息：是否已激活、是否要口令 / 人机验证、视图模式、取码方式与剩余次数、轮询间隔、收件地址（按规则处理）、失效时间、标题与说明。无副作用 |
| POST | `/api/s/:token/start` | "开始取码"：提交口令与 Turnstile（如有），登记设备、发访客 Cookie、激活链接 |
| POST | `/api/s/:token/mails/:id/reveal` | `click` 取码方式下显示某封邮件的内容并计一次 |
| GET | `/api/s/:token/mails` | `cursor` 翻页；`after_id` 增量轮询 |
| GET | `/api/s/:token/mails/:id` | 详情（`code_only` / `meta_only` 视图下 404） |
| GET | `/api/s/:token/mails/:id/attachments/:index` | 仅当规则组允许下载 |

返回的邮件对象已按规则组呈现配置裁剪，**不包含 raw、不包含被隐藏的字段**：

```ts
type PresentedMail = {
  id: number;
  received_at: number;
  sender?: { address?: string; domain?: string; name?: string };
  recipient?: string;
  subject?: string;
  snippet?: string;
  code?: string;
  login_link?: string;
  locked?: boolean;     // click 取码方式下尚未显示，此时不含 subject / snippet / code
  attachments?: Array<{ index: number; name: string; size: number; downloadable: boolean }>;
  // 仅详情：
  text?: string;
  html?: string;        // 已清洗
};
```

## 管理端

| 资源 | 路由 | 说明 |
| --- | --- | --- |
| 收件地址 | GET `/api/admin/mailboxes` | 过滤：关键词、标签、状态；附带链接数、授权数 |
| | POST `/api/admin/mailboxes/import` | 文本或 CSV；`dry_run=true` 只返回预览（新增 / 重复 / 无效） |
| | PATCH / DELETE `/api/admin/mailboxes/:id` | |
| | POST `/api/admin/mailboxes/batch` | 批量打标签、启停、删除 |
| | GET `/api/admin/mailboxes/discover` | 从 `MAIL_DB` 找出有邮件但未导入的 `to_address`（二期） |
| 规则组 | GET / POST `/api/admin/rule-groups`；GET / PUT / DELETE `/:id` | PUT 带 `revision` 做乐观锁 |
| | GET `/api/admin/rule-groups/:id/usage` | 被哪些链接与授权引用 |
| | POST `/api/admin/rule-groups/test` | 入参：配置 + 收件地址或邮件 id；返回逐封 trace 与预览 |
| | POST `/api/admin/rule-groups/draft-from-mail` | 入参：邮件 id；返回一条 allow 规则草稿（发件人域名、主题模式、验证码正则） |
| 取件链接 | GET `/api/admin/links` | 过滤：状态、规则组、收件地址、订单号；附带设备数、近 24 小时取码数、异常标记 |
| | POST `/api/admin/links` | 单个或批量（`per_mailbox` / `combined`） |
| | PATCH / DELETE `/api/admin/links/:id` | 改状态、过期、规则组、访问约束 |
| | GET `/api/admin/links/:id/token` | 取回完整链接，写审计 |
| | POST `/api/admin/links/:id/rotate` | 重置 token |
| | POST `/api/admin/links/:id/rebind` | 售后换号：换收件地址，可选同时重置起始时间、设备、取码次数 |
| | POST `/api/admin/links/:id/reset` | 单独重置起始时间 / 设备 / 取码次数 |
| | GET `/api/admin/links/:id/preview` | 以该链接的身份求值，返回邮件、逐封 trace、设备与取码记录；无任何副作用 |
| | POST `/api/admin/links/batch` | 批量延长有效期、暂停、恢复、撤销、换规则组 |
| | GET `/api/admin/links/:id/logs` | 访问日志 |
| | POST `/api/admin/links/export` | 导出 CSV，或按行模板导出（如 `{address}----{link}`） |
| 授权 | GET `/api/admin/grants` | 按用户或按收件地址查 |
| | POST `/api/admin/grants/batch`；PATCH / DELETE `/:id` | |
| 全部邮件 | GET `/api/admin/mails` | 过滤：收件地址、信封地址、信封发件人、时间范围、范围（全部 / 已导入地址 / 未知地址） |
| | GET `/api/admin/mails/:id` | 解析结果；`?raw=1` 带原文 |
| | GET `/api/admin/mails/:id/attachments/:index` | |
| 用户 | GET / POST `/api/admin/users`；GET / PATCH / DELETE `/:id` | |
| | POST `/:id/password`；DELETE `/:id/totp`、`/:id/passkeys[/:pid]`、`/:id/identities[/:iid]`、`/:id/sessions` | 见 03 §6 |
| 设置 | GET / PUT `/api/admin/settings/:group` | |
| | GET / POST / PUT / DELETE `/api/admin/oauth-providers[/:id]` | |
| | POST `/api/admin/oauth-providers/discover` | 传 issuer，服务端取回 OIDC 发现文档填表 |
| 系统 | GET `/api/admin/system/health` | `MAIL_DB` 探测结果、索引规模、cron 状态 |
| 审计 | GET `/api/admin/audit-logs` | |

`oauth-providers/discover` 会让服务端请求管理员给的地址：只允许 `https`，并校验返回的是合法发现文档。
