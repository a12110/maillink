-- FIN-A：取码记录（link_deliveries）带上邮件身份。
-- temp_email 删除邮件后，新邮件可能复用同一个 id。只按 (link_id, mail_id) 记取码时，复用 id 的新邮件会被当成
-- "已取过"，click 模式下不点取、不计次就显示。现在同时记下交付时这封邮件的 message_id / received_at / recipient，
-- 与 mail_index 判定 id 复用同一口径（src/mail-index/identity.ts）：三项都一致才算这封已取过，否则视为未取码（失败关闭）。
-- 原主键 (link_id, mail_id) 容不下同一 id 的第二封，只能重建表。"同一封只记一次"与次数上限一样由单条条件 INSERT 保证
-- （D1 对同一个库串行执行语句，见 src/db/link-activity.ts）；唯一表达式索引 ux_ld_mail_identity 在库层兜底。
-- 索引里 message_id 用 IFNULL(…, '')：SQLite 唯一索引把 NULL 视为互不相同，不转换的话 message_id 为 NULL 的
-- 同一封邮件可以重复写入。代价是 NULL 与 '' 在索引里视为相同（条件 INSERT 用 IS 区分）：同一 id、同一秒、同一收件人
-- 而 message_id 一个 NULL 一个 '' 的复用实际不会出现，真出现时插入报唯一约束错误（暴露，不静默）。
-- 旧行 received_at / recipient 为 NULL，不受索引约束（它们来自旧主键，本来就每个 (link_id, mail_id) 一行）。
-- 旧行没有身份（三列为 NULL）：读取时一律按"不一致"处理，但仍计入次数。项目尚未部署、没有存量数据，
-- 拷贝旧行只是为了这条迁移在任何库上执行都不丢计次。
CREATE TABLE link_deliveries_v2 (
  link_id INTEGER NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  mail_id INTEGER NOT NULL,
  mail_message_id TEXT,
  mail_received_at INTEGER,
  mail_recipient TEXT,
  visitor_hash TEXT NOT NULL,
  delivered_at INTEGER NOT NULL
);
INSERT INTO link_deliveries_v2 (link_id, mail_id, visitor_hash, delivered_at)
  SELECT link_id, mail_id, visitor_hash, delivered_at FROM link_deliveries;
DROP TABLE link_deliveries;
ALTER TABLE link_deliveries_v2 RENAME TO link_deliveries;
CREATE INDEX idx_ld_link_time ON link_deliveries(link_id, delivered_at);
-- 前缀 (link_id, mail_id) 同时服务按邮件查取码记录
CREATE UNIQUE INDEX ux_ld_mail_identity
  ON link_deliveries(link_id, mail_id, IFNULL(mail_message_id, ''), mail_received_at, mail_recipient);
