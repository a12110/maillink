-- M3b-2：取件链接（只新增索引，表结构已在 0001，与 01 §5 一致）。
-- 口令错误次数（按链接 + IP + 时间窗口计）与访问日志按时间查询：link_access_logs 按 (link_id, created_at)。
-- 设备登记按 (link_id, visitor_hash) 主键，取码计数用 0001 的 idx_ld_link_time，不需要新索引。
CREATE INDEX idx_lal_link_time ON link_access_logs(link_id, created_at);
