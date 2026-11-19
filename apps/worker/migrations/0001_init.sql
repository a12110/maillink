-- APP_DB 初始结构。严格对应 docs/design/01-architecture-and-data.md §5，改动需先改设计文档。

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
