-- M3b-2：取件链接（只新增索引，表结构已在 0001，与 01 §5 一致）。
-- 口令错误次数（按链接 + IP + 时间窗口计）与访问日志按时间查询：link_access_logs 按 (link_id, created_at)。
-- 设备登记按 (link_id, visitor_hash) 主键，取码计数用 0001 的 idx_ld_link_time，不需要新索引。
CREATE INDEX idx_lal_link_time ON link_access_logs(link_id, created_at);

-- 访问口令的失败名额（M3b-2 验收修复）：PBKDF2 之前先用带条件的 INSERT 占一个名额，并发请求也不能突破上限；
-- 口令正确时删掉占位。ip_bucket：IPv4 原样、IPv6 取 /64、拿不到 IP 为 unknown。过期行由 cron 清理（M7 待接）。
CREATE TABLE link_password_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  ip_bucket TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_lpa_link_time ON link_password_attempts(link_id, created_at);
