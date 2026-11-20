-- API-CODE 安全验收：链接口令校验把"进行中"与"已失败"分开。
-- 原做法在 PBKDF2 之前往 link_password_attempts 占一个"失败名额"、口令正确才删掉，进行中的请求也计入"错 5 次锁定"：
-- 同一 IP 并发 12 个正确口令会有 7 个被判 link_password_locked。现在：
--   - link_password_attempts 只记已失败的校验（口径不变：链接 + IP 桶、链接全局两层上限，窗口不变）；
--   - link_password_inflight 记进行中的校验，PBKDF2 结束（成功、失败、异常）即删除；expires_at 是兜底，
--     Worker 被中断没来得及删的占位过期后不再计数，由每日 cron 清掉。
-- 存量 link_password_attempts 行都是已失败的占位（口令正确时会被删），原样保留，含义不变。
CREATE TABLE link_password_inflight (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  ip_bucket TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
-- 前缀 (link_id) 同时服务按链接全局计数
CREATE INDEX idx_lpi_link_bucket ON link_password_inflight(link_id, ip_bucket, expires_at);
