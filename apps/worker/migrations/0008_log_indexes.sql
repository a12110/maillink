-- M7a：日志表索引（只新增）。
-- idx_audit_created / idx_lal_created：每日清理按 created_at 删除过期日志，没有索引会全表扫描。
-- idx_audit_action：审计日志列表按动作筛选后 id 倒序翻页。
-- idx_audit_actor：按执行者筛选。
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_audit_action ON audit_logs(action, id);
CREATE INDEX idx_audit_actor ON audit_logs(actor_user_id, id);
CREATE INDEX idx_lal_created ON link_access_logs(created_at);
