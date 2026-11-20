-- M3b：收件地址与规则组接口用到的引用计数、筛选与用量查询的索引（只新增，不改已有迁移）。
-- mailbox_tags 的主键是 (mailbox_id, tag)，按标签筛选需要单独的 tag 索引；
-- share_links / user_mailbox_grants 按 rule_group_id、user_mailbox_grants 按 mailbox_id 计数与列出引用方。
CREATE INDEX idx_mailbox_tags_tag ON mailbox_tags(tag, mailbox_id);
CREATE INDEX idx_share_links_rule_group ON share_links(rule_group_id);
CREATE INDEX idx_umg_mailbox ON user_mailbox_grants(mailbox_id);
CREATE INDEX idx_umg_rule_group ON user_mailbox_grants(rule_group_id);
