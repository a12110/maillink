import type { LinkLog } from "@maillink/shared";
import { LINK_DELIVERY_WINDOW_SEC, LIST_PAGE_SIZE } from "../constants";

// 取件链接的访问痕迹：设备（link_visitors）、取码记录（link_deliveries）、访问日志（link_access_logs）。
// 计数类写入都用单条条件 INSERT：D1 对同一个库串行执行语句，条件判断与写入在一条语句里，并发请求不会突破上限。

export type ClientInfo = { ip: string | null; country: string | null; user_agent: string | null };

export type LinkLogEntry = ClientInfo & {
  link_id: number;
  event: LinkLog["event"];
  mail_id: number | null;
  reason: string | null;
  created_at: number;
};

export function accessLogStatement(db: D1Database, entry: LinkLogEntry): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO link_access_logs (link_id, event, mail_id, reason, ip, country, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(entry.link_id, entry.event, entry.mail_id, entry.reason, entry.ip, entry.country, entry.user_agent, entry.created_at);
}

export async function insertAccessLog(db: D1Database, entry: LinkLogEntry): Promise<void> {
  await accessLogStatement(db, entry).run();
}

export async function visitorExists(db: D1Database, linkId: number, visitorHash: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS found FROM link_visitors WHERE link_id = ? AND visitor_hash = ?")
    .bind(linkId, visitorHash)
    .first<{ found: number }>();
  return row !== null;
}

export async function countVisitors(db: D1Database, linkId: number): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM link_visitors WHERE link_id = ?").bind(linkId).first<{ n: number }>();
  return row?.n ?? 0;
}

/** 设备数未满时登记新设备；满了返回 false（maxDevices 为 null 表示不限） */
export async function registerVisitor(
  db: D1Database,
  linkId: number,
  visitorHash: string,
  maxDevices: number | null,
  client: ClientInfo,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO link_visitors (link_id, visitor_hash, first_seen_at, last_seen_at, ip, country, user_agent)
       SELECT ?1, ?2, ?3, ?3, ?4, ?5, ?6
       WHERE ?7 IS NULL OR (SELECT COUNT(*) FROM link_visitors WHERE link_id = ?1) < ?7`,
    )
    .bind(linkId, visitorHash, now, client.ip, client.country, client.user_agent, maxDevices)
    .run();
  return result.meta.changes > 0;
}

export function touchVisitorStatement(db: D1Database, linkId: number, visitorHash: string, client: ClientInfo, now: number): D1PreparedStatement {
  return db
    .prepare("UPDATE link_visitors SET last_seen_at = ?, ip = ?, country = ?, user_agent = ? WHERE link_id = ? AND visitor_hash = ?")
    .bind(now, client.ip, client.country, client.user_agent, linkId, visitorHash);
}

/** 首次"开始取码"写 first_access_at（只写一次）；每次开始取码与交付都刷新 last_access_at（06 §9） */
export function markLinkAccessStatement(db: D1Database, linkId: number, now: number, firstAccess: boolean): D1PreparedStatement {
  const sql = firstAccess
    ? "UPDATE share_links SET first_access_at = COALESCE(first_access_at, ?1), last_access_at = ?1 WHERE id = ?2"
    : "UPDATE share_links SET last_access_at = ?1 WHERE id = ?2";
  return db.prepare(sql).bind(now, linkId);
}

export type DeliveryCounts = { total: number; daily: number; oldest_in_window: number | null };

export async function deliveryCounts(db: D1Database, linkId: number, now: number): Promise<DeliveryCounts> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN delivered_at > ?2 THEN 1 ELSE 0 END), 0) AS daily,
         MIN(CASE WHEN delivered_at > ?2 THEN delivered_at END) AS oldest_in_window
       FROM link_deliveries WHERE link_id = ?1`,
    )
    .bind(linkId, now - LINK_DELIVERY_WINDOW_SEC)
    .first<DeliveryCounts>();
  return row ?? { total: 0, daily: 0, oldest_in_window: null };
}

export async function deliveredMailIds(db: D1Database, linkId: number, mailIds: readonly number[]): Promise<Set<number>> {
  if (mailIds.length === 0) return new Set();
  const { results } = await db
    .prepare("SELECT mail_id FROM link_deliveries WHERE link_id = ? AND mail_id IN (SELECT value FROM json_each(?))")
    .bind(linkId, JSON.stringify(mailIds))
    .all<{ mail_id: number }>();
  return new Set(results.map((row) => row.mail_id));
}

export type DeliveryLimits = { total: number | null; daily: number | null };

/**
 * 交付一封邮件：同一封已交付过则不写（不重复计次）；总数与滚动 24 小时数都未满才写。
 * 返回是否新写入；调用方再据 deliveredMailIds / deliveryCounts 区分"已交付过"与"次数已满"。
 */
export async function insertDeliveryIfAllowed(
  db: D1Database,
  input: { link_id: number; mail_id: number; visitor_hash: string; now: number },
  limits: DeliveryLimits,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO link_deliveries (link_id, mail_id, visitor_hash, delivered_at)
       SELECT ?1, ?2, ?3, ?4
       WHERE NOT EXISTS (SELECT 1 FROM link_deliveries WHERE link_id = ?1 AND mail_id = ?2)
         AND (?5 IS NULL OR (SELECT COUNT(*) FROM link_deliveries WHERE link_id = ?1) < ?5)
         AND (?6 IS NULL OR (SELECT COUNT(*) FROM link_deliveries WHERE link_id = ?1 AND delivered_at > ?7) < ?6)`,
    )
    .bind(input.link_id, input.mail_id, input.visitor_hash, input.now, limits.total, limits.daily, input.now - LINK_DELIVERY_WINDOW_SEC)
    .run();
  return result.meta.changes > 0;
}

export async function listAccessLogs(
  db: D1Database,
  linkId: number,
  cursor: number | null,
  limit: number = LIST_PAGE_SIZE,
): Promise<{ items: LinkLog[]; next_cursor: string | null }> {
  const { results } = await db
    .prepare(
      `SELECT id, event, mail_id, reason, ip, country, user_agent, created_at FROM link_access_logs
       WHERE link_id = ?1 AND (?2 IS NULL OR id < ?2) ORDER BY id DESC LIMIT ?3`,
    )
    .bind(linkId, cursor, limit + 1)
    .all<LinkLog>();
  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;
  const last = items.at(-1);
  return { items, next_cursor: hasMore && last ? String(last.id) : null };
}

export type VisitorRow = ClientInfo & { visitor_hash: string; first_seen_at: number; last_seen_at: number };
export type DeliveryRow = { mail_id: number; visitor_hash: string; delivered_at: number };

export async function listVisitors(db: D1Database, linkId: number, limit: number): Promise<VisitorRow[]> {
  const { results } = await db
    .prepare(
      `SELECT visitor_hash, first_seen_at, last_seen_at, ip, country, user_agent FROM link_visitors
       WHERE link_id = ? ORDER BY first_seen_at DESC LIMIT ?`,
    )
    .bind(linkId, limit)
    .all<VisitorRow>();
  return results;
}

export async function listDeliveries(db: D1Database, linkId: number, limit: number): Promise<DeliveryRow[]> {
  const { results } = await db
    .prepare("SELECT mail_id, visitor_hash, delivered_at FROM link_deliveries WHERE link_id = ? ORDER BY delivered_at DESC LIMIT ?")
    .bind(linkId, limit)
    .all<DeliveryRow>();
  return results;
}
