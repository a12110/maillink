# 01 架构与数据

## 1. 仓库结构

```
apps/
  worker/                 # Cloudflare Worker (Hono + TS)
    src/
      index.ts            # 路由挂载、scheduled 入口
      env.ts              # Bindings 类型
      constants.ts        # 所有上限/默认值，禁止散落的 magic number
      middleware/         # session、csrf、rate-limit、error
      mail-source/        # 【唯一】接触 MAIL_DB 的模块：schema 探测、候选列表、取 raw、gzip
      mail-parse/         # postal-mime 解析、X-ICLOUD-HME、正文归一化、验证码提取
      mail-index/         # APP_DB.mail_index 读写
      rules/              # 规则 schema、编译、求值、trace（纯函数，无 IO）
      render/             # 视图模式、HTMLRewriter 清洗、脱敏
      access/             # 主体 → AccessScope
      auth/               # password、totp、webauthn、oauth、session
      routes/             # public、auth、me、link、admin/*
      db/                 # drizzle schema（仅 APP_DB）
    migrations/           # 仅 APP_DB 的迁移
    test/                 # vitest + @cloudflare/vitest-pool-workers；fixtures/*.eml
  web/                    # 前端 SPA
packages/
  shared/                 # zod schema 与 API 类型，前后端共用（规则组 schema 在这里）
docs/design/
```

依赖方向：`routes → access → mail-source / mail-index / rules / render`。`rules` 不依赖任何 IO，便于表驱动单测。

## 2. 部署与绑定

```jsonc
// wrangler.jsonc（示意，字段以当前 wrangler 文档为准）
{
  "name": "mail-link",
  "main": "apps/worker/src/index.ts",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "apps/web/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    { "binding": "APP_DB",  "database_name": "mail-link", "database_id": "...", "migrations_dir": "apps/worker/migrations" },
    { "binding": "MAIL_DB", "database_name": "<temp_email 的库>", "database_id": "<同一个 id>" }
  ],
  "triggers": { "crons": ["*/5 * * * *", "17 3 * * *"] },
  "vars": { "PUBLIC_ORIGIN": "https://mail.example.com" }
}
```

| 配置 | 类型 | 用途 |
| --- | --- | --- |
| `APP_DB` | D1 | 自有数据，唯一带 `migrations_dir` |
| `MAIL_DB` | D1 | temp_email 的库。**不配 migrations_dir，迁移命令永远不指向它** |
| `ASSETS` | Static Assets | 前端 |
| `RATE_LIMITER` | Rate Limiting（可选） | 登录与链接访问限流；未绑定时该功能显式报"未配置"，不静默放行 |
| `PUBLIC_ORIGIN` | var | WebAuthn RP ID、OAuth 回调地址、Cookie 域的唯一来源。换域名会让已注册的 Passkey 失效 |
| `APP_SECRET` | secret | 主密钥。用 HKDF 派生：链接 token 加密、TOTP 密钥加密、OAuth client secret 加密、Cookie 签名、密码 pepper |
| `SETUP_TOKEN` | secret | 首次初始化创建管理员时校验，用完可删 |

只读约束靠代码保证（D1 没有只读 binding）：`mail-source` 只导出查询函数；加一个单测扫描该目录源码，出现 `INSERT/UPDATE/DELETE/ALTER/DROP` 即失败。

Cron：每 5 分钟预热 `mail_index`（已导入地址的新邮件）；每天一次清理过期会话、过期日志、`MAIL_DB` 里已不存在的索引行。

本地开发：`scripts/seed-mail-db` 用 temp_email 的 `db/schema.sql` 建本地 `MAIL_DB`，再灌入 `test/fixtures/*.eml`（需要一封脱敏后的真实 iCloud HME 转发邮件做样本）。

## 3. 邮件库读取契约（MAIL_DB）

已核对的事实（路径相对 `cloudflare_temp_email/`）：

| 事实 | 依据 |
| --- | --- |
| `raw_mails(id, message_id, source, address, to_address, raw, raw_blob, metadata, is_unread, created_at)` | `db/schema.sql:1-12` |
| `address` = SMTP 信封收件人（转发链最后一跳）；`to_address` = 从邮件头解析的真实收件人 | `db/2026-08-02-to-address.sql:1-3`，`worker/src/email/index.ts:23-24,75-77` |
| iCloud 别名取自 `X-ICLOUD-HME` 头的 `p=`；同一个头的 `s=` 是**原始发件人** | `worker/src/email/recipient_policy.ts:62-66` |
| 地址只把域名部分转小写，本地部分保留原大小写 | `recipient_policy.ts:36-41` |
| 开启 `ENABLE_MAIL_GZIP` 时正文在 `raw_blob`（gzip），否则在 `raw`；D1 返回的 BLOB 是 `Array<number>` | `worker/src/email/storage.ts:44-54`，`worker/src/gzip.ts:21-32` |
| `metadata` 是 JSON：`{ ai_extract: { type, result, result_text }, extracted_at }`，`type` 含 `auth_code` | `worker/src/email/ai_extract.ts:158-161` |
| `source` = 信封发件人 `message.from`；`created_at` 是 UTC 文本 `YYYY-MM-DD HH:MM:SS` | `worker/src/email/index.ts:75-77`，`db/schema.sql:11` |
| `to_address` 是 fork 独有列，不随上游 DB_VERSION | `worker/src/admin_api/db_api.ts:171-172` |

### 3.1 schema 探测

启动后首次请求与 `/api/admin/system/health` 执行 `PRAGMA table_info(raw_mails)` 并读 `settings.db_version`，结果在 isolate 内缓存：

| 列 | 缺失时 |
| --- | --- |
| `to_address` | 改为只按 `address` 匹配，并在管理端系统页显示醒目警告（iCloud 别名将匹配不到） |
| `raw_blob` | 只读 `raw` |
| `metadata` | 不读取 temp_email 的提取结果，只用本地提取 |
| `id/source/address/raw/created_at` 任一 | 健康检查失败，邮件相关接口返回 503 与明确错误 |

### 3.2 查询约定

候选列表**不取正文**（`raw` 可能接近 2 MB）：

```sql
SELECT id, message_id, source, address, to_address, created_at
FROM raw_mails
WHERE (to_address IN (SELECT value FROM json_each(?1))
       OR (to_address IS NULL AND address IN (SELECT value FROM json_each(?1))))
  AND created_at >= ?2      -- 规则的时间下界，下推
  AND id < ?3               -- 游标
ORDER BY id DESC
LIMIT ?4
```

- `?1` 是地址 JSON 数组：每个收件地址放"导入时原样（域名小写）"和"全小写"两种形式，避开大小写问题又能走索引。用 `json_each` 绕开 100 个绑定参数上限。
- 时间比较必须用同格式文本。`mail-source` 提供 `formatD1Utc(ms)` / `parseD1Utc(text)`，别处不许手拼。
- 分页用 `id` 游标，不用 offset（规则是后置过滤，offset 会错位）。
- 取正文单独查，按 5 封一批：`SELECT id, raw, raw_blob, metadata FROM raw_mails WHERE id IN (SELECT value FROM json_each(?1))`。
- 增量轮询：`id > ?after_id`。
- 管理员"全部邮件"不带地址条件，可选 `address = ?` / `to_address = ?` / `source = ?` / 时间范围。

## 4. 解析与索引

### 4.1 邮件事实（MailFacts）

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `recipient` | `to_address`，空则 `address` | 全小写 |
| `sender.address` | 候选集合：`From` 头地址 + `X-ICLOUD-HME` 的 `s=`（仅当其 `p=` 等于本邮件收件地址） | 还不确定 `s=` 是头部发件人还是信封发件人，也不确定 Apple 是否改写 `From`，所以两者都保留，规则按任一命中判定。展示用哪个，M2 拿真实样本定稿 |
| `sender.domain` / `sender.name` | 候选地址的域名集合 / `From` 显示名 | |
| `sender.envelope` | `source` | 仅供管理员查看与高级规则 |
| `subject` | 解码后的主题 | |
| `body` | text/plain 与 html→text **两者拼接**后归一化 | 判定用全集，防止两个 part 内容不一致绕过黑名单 |
| `links` | 正文中的 URL（去重，数量与长度有上限） | 域名由它派生；也用于提取登录链接 |
| `attachments` | 文件名、类型、大小 | |
| `code` | `metadata.ai_extract`（type=auth_code）→ 本地规则提取 | 可为空 |
| `category` | 内置分类器，见 02 §3.6 | |
| `raw_size`、`has_html`、`body_truncated` | | |

归一化（判定用）：NFKC → 去零宽字符与软连字符 → 合并空白。大小写在比较时处理。

### 4.2 流程

1. 拿到候选行后，用 id 批量查 `mail_index`。
2. 命中且 `message_id`、`received_at` 与候选行一致、`parser_version` 为当前版本 → 直接用。
3. 否则取 raw、解 gzip、`postal-mime` 解析、生成事实、写回索引。
4. 单次请求最多现场解析 `MAX_PARSE_PER_REQUEST` 封；超出时响应带 `partial: true`，前端短延时后重取。这是有界工作量，不是降级。
5. 解析失败：写 `parse_status='failed'` 与错误信息。链接与用户侧**隐藏**该邮件；管理员侧显示"解析失败"并可看原文。

## 5. 自有库表结构（APP_DB）

约定：主键 `INTEGER PRIMARY KEY AUTOINCREMENT`；时间用 `INTEGER`（Unix 秒，UTC）；JSON 存 `TEXT`；全部参数化查询；外键开启。

```sql
-- 用户与认证 -------------------------------------------------------------
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  username_lc TEXT NOT NULL UNIQUE,
  email_lc TEXT,
  display_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','user')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  password_hash TEXT,                 -- NULL = 未设密码
  totp_secret_enc TEXT,               -- AES-GCM 密文；NULL = 未启用
  totp_enabled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE UNIQUE INDEX idx_users_email ON users(email_lc) WHERE email_lc IS NOT NULL;

CREATE TABLE user_recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at INTEGER
);

CREATE TABLE user_passkeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE oauth_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('oidc','oauth2')),
  enabled INTEGER NOT NULL DEFAULT 1,
  issuer TEXT,
  authorization_endpoint TEXT, token_endpoint TEXT, userinfo_endpoint TEXT, jwks_uri TEXT,
  client_id TEXT NOT NULL,
  client_secret_enc TEXT NOT NULL,
  scopes TEXT NOT NULL,
  claim_map TEXT NOT NULL,            -- {"subject":"sub","email":"email","email_verified":"email_verified","name":"name"}
  allow_signup INTEGER NOT NULL DEFAULT 0,
  auto_link_verified_email INTEGER NOT NULL DEFAULT 0,
  icon TEXT, sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE user_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id INTEGER NOT NULL REFERENCES oauth_providers(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  email TEXT, display_name TEXT,
  created_at INTEGER NOT NULL, last_login_at INTEGER,
  UNIQUE (provider_id, subject)
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,           -- sha256(cookie 值)
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_methods TEXT NOT NULL,         -- 如 "password,totp" / "passkey" / "oauth:github"
  created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  ip TEXT, user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- 业务 -------------------------------------------------------------------
CREATE TABLE mailboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,              -- 导入时的写法，域名小写
  address_lc TEXT NOT NULL UNIQUE,
  label TEXT, note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE mailbox_tags (
  mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (mailbox_id, tag)
);

CREATE TABLE rule_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  config TEXT NOT NULL,               -- 见 02-rule-engine.md
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE share_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  order_ref TEXT,                     -- 外部订单号 / 买家备注，可搜索
  public_title TEXT, public_note TEXT,-- 取件页上给访问者看的标题与说明
  token_hash TEXT NOT NULL UNIQUE,
  token_enc TEXT NOT NULL,
  token_hint TEXT NOT NULL,           -- token 前 6 位，列表里辨认用
  rule_group_id INTEGER NOT NULL REFERENCES rule_groups(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked')),
  valid_from INTEGER, expires_at INTEGER,
  expire_after_first_access_sec INTEGER,
  access TEXT NOT NULL,               -- 访问约束 JSON，见 02 §6
  anchor_reset_at INTEGER,            -- 换绑或手动重置起始时间
  first_access_at INTEGER, last_access_at INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE share_link_mailboxes (
  link_id INTEGER NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  PRIMARY KEY (link_id, mailbox_id)
);
CREATE INDEX idx_slm_mailbox ON share_link_mailboxes(mailbox_id);

CREATE TABLE link_visitors (          -- 点过"开始取码"的浏览器，用于设备数上限
  link_id INTEGER NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  visitor_hash TEXT NOT NULL,         -- sha256(访客 Cookie)
  first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  ip TEXT, country TEXT, user_agent TEXT,
  PRIMARY KEY (link_id, visitor_hash)
);

CREATE TABLE link_deliveries (        -- 某链接已交付过的邮件，用于计次与留证
  link_id INTEGER NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  mail_id INTEGER NOT NULL,
  visitor_hash TEXT NOT NULL,
  delivered_at INTEGER NOT NULL,
  PRIMARY KEY (link_id, mail_id)
);
CREATE INDEX idx_ld_link_time ON link_deliveries(link_id, delivered_at);

CREATE TABLE user_mailbox_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  rule_group_id INTEGER REFERENCES rule_groups(id) ON DELETE RESTRICT,  -- NULL = 完整访问
  expires_at INTEGER, first_access_at INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, mailbox_id)
);

CREATE TABLE mail_index (
  mail_id INTEGER PRIMARY KEY,        -- raw_mails.id
  message_id TEXT, received_at INTEGER NOT NULL,   -- 与候选行比对，防 id 复用
  recipient TEXT NOT NULL,
  sender_address TEXT, sender_domain TEXT, sender_name TEXT, sender_envelope TEXT,
  subject TEXT,
  body_text TEXT, body_truncated INTEGER NOT NULL DEFAULT 0,
  links TEXT, attachments TEXT, code TEXT, category TEXT,
  raw_size INTEGER, has_html INTEGER,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('ok','failed')),
  parse_error TEXT,
  parser_version INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE INDEX idx_mail_index_recipient ON mail_index(recipient, mail_id);

-- 日志与设置 -------------------------------------------------------------
CREATE TABLE link_access_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  event TEXT NOT NULL,                -- start / deliver / download / denied
  mail_id INTEGER, reason TEXT,
  ip TEXT, country TEXT, user_agent TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_lal_link ON link_access_logs(link_id, id);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER, action TEXT NOT NULL,
  target_type TEXT, target_id TEXT, detail TEXT,
  ip TEXT, created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER
);
```

说明：

- 删除收件地址会级联删掉它在链接与授权里的关联；删到链接下没有地址时，链接保留但访问返回"无可用邮箱"。
- 被引用的规则组不能删（`RESTRICT`），界面提示被哪些链接/授权使用。
- 只记"访问"与"查看邮件"，不记每次轮询。日志保留期在系统设置里配，cron 清理。
- `mail_index.body_text` 上限见 `constants.ts`（默认 32 KB），是正文在自有库的一份副本，随源邮件删除而清理。

## 6. 常量（集中在 `constants.ts`）

| 常量 | 默认 | 说明 |
| --- | --- | --- |
| `LIST_PAGE_SIZE` | 20 | |
| `SCAN_CAP_PER_REQUEST` | 200 | 单次请求最多扫描的候选行 |
| `MAX_PARSE_PER_REQUEST` | 10 | 单次请求现场解析上限 |
| `RAW_FETCH_CHUNK` | 5 | 一次取几封正文 |
| `BODY_INDEX_CAP_BYTES` | 32768 | |
| `MAX_MAILBOXES_PER_LINK` | 50 | |
| `LINK_TOKEN_BYTES` | 32 | base64url |
| `LINK_POLL_MIN_SEC` | 10 | |
| `SESSION_IDLE_SEC` / `SESSION_ABSOLUTE_SEC` | 7 天 / 30 天 | 可被系统设置覆盖 |
| `PENDING_MFA_SEC` / `OAUTH_STATE_SEC` | 300 / 600 | |
