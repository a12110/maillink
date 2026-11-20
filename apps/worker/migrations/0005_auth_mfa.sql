-- M5：两步验证、通行密钥、OAuth 所需的补充结构（只新增，不改 0001_init.sql）。

-- 最近一次成功使用的 TOTP 时间步（Unix 秒 / 30）。同一时间步及更早的码不能再用，防止验证码重放。
ALTER TABLE users ADD COLUMN totp_last_step INTEGER;

-- 按用户（跨 IP、跨 pending_auth）的第二因素失败计数与锁定，见 auth/second-factor-throttle.ts。
-- 登录第二步（TOTP / 恢复码）与敏感操作再确认（密码 / TOTP）共用这一组计数。
ALTER TABLE users ADD COLUMN mfa_fail_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mfa_fail_window_start INTEGER;
ALTER TABLE users ADD COLUMN mfa_locked_until INTEGER;

-- 当前邮箱是否由管理员设置（创建用户或管理端修改时为 1；用户自己改邮箱或清空时回到 0）。
-- 本系统不验证邮箱，OAuth "按已验证邮箱自动关联" 只允许关联到这类账号，见 auth/oauth-link.ts。
ALTER TABLE users ADD COLUMN email_admin_set INTEGER NOT NULL DEFAULT 0;

-- 短时流程令牌（pending_auth、通行密钥 challenge、OAuth state）的一次性消费记录。
-- 令牌本身在签名 / 加密 Cookie 里，不落库；这里只记它的随机 jti，用于"只能用一次"与错误次数上限。
-- 过期行可随时删除：令牌过期后签名校验本身就会拒绝。
CREATE TABLE auth_flow_tokens (
  jti TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_auth_flow_tokens_expires ON auth_flow_tokens(expires_at);
