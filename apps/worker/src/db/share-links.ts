import type { ShareLinkListQuery, ShareLinkState, ShareLinkStatus } from "@maillink/shared";
import { LINK_DELIVERY_WINDOW_SEC, LIST_PAGE_SIZE } from "../constants";

// share_links / share_link_mailboxes 的读写（APP_DB，全部参数化）。数组参数用 json_each 传，避开绑定参数个数上限。

export type ShareLinkRow = {
  id: number;
  name: string | null;
  order_ref: string | null;
  public_title: string | null;
  public_note: string | null;
  token_hash: string;
  token_enc: string;
  token_hint: string;
  rule_group_id: number;
  rule_group_name: string;
  /** 规则组配置原文（公开接口编译用） */
  rule_group_config: string;
  status: ShareLinkStatus;
  valid_from: number | null;
  expires_at: number | null;
  expire_after_first_access_sec: number | null;
  /** 访问约束 JSON 原文 */
  access: string;
  anchor_reset_at: number | null;
  first_access_at: number | null;
  last_access_at: number | null;
  created_at: number;
  updated_at: number;
};

export type ShareLinkStatsRow = ShareLinkRow & {
  state: ShareLinkState;
  device_count: number;
  country_count: number;
  deliveries_24h: number;
  deliveries_total: number;
};

export type LinkMailboxRow = { link_id: number; id: number; address: string; note: string | null; status: string };

const LINK_COLUMNS = `l.id, l.name, l.order_ref, l.public_title, l.public_note, l.token_hash, l.token_enc, l.token_hint,
  l.rule_group_id, r.name AS rule_group_name, r.config AS rule_group_config, l.status, l.valid_from, l.expires_at,
  l.expire_after_first_access_sec, l.access, l.anchor_reset_at, l.first_access_at, l.last_access_at, l.created_at, l.updated_at`;

const FROM_LINKS = "FROM share_links l JOIN rule_groups r ON r.id = l.rule_group_id";

/** 派生状态，口径与公开接口的检查顺序一致：状态 → 过期 → 未生效 → 总次数用尽（?1 = 现在） */
const STATE_SQL = `CASE
    WHEN l.status = 'revoked' THEN 'revoked'
    WHEN l.status = 'paused' THEN 'paused'
    WHEN l.expires_at IS NOT NULL AND l.expires_at <= ?1 THEN 'expired'
    WHEN l.first_access_at IS NOT NULL AND l.expire_after_first_access_sec IS NOT NULL
      AND l.first_access_at + l.expire_after_first_access_sec <= ?1 THEN 'expired'
    WHEN l.valid_from IS NOT NULL AND l.valid_from > ?1 THEN 'pending'
    WHEN json_extract(l.access, '$.max_deliveries_total') IS NOT NULL
      AND (SELECT COUNT(*) FROM link_deliveries d WHERE d.link_id = l.id) >= json_extract(l.access, '$.max_deliveries_total')
      THEN 'exhausted'
    ELSE 'active' END`;

/** ?1 = 现在，?2 = 24 小时窗口起点 */
const STATS_SELECT = `SELECT ${LINK_COLUMNS},
    ${STATE_SQL} AS state,
    (SELECT COUNT(*) FROM link_visitors v WHERE v.link_id = l.id) AS device_count,
    (SELECT COUNT(DISTINCT v.country) FROM link_visitors v WHERE v.link_id = l.id AND v.country IS NOT NULL) AS country_count,
    (SELECT COUNT(*) FROM link_deliveries d WHERE d.link_id = l.id AND d.delivered_at > ?2) AS deliveries_24h,
    (SELECT COUNT(*) FROM link_deliveries d WHERE d.link_id = l.id) AS deliveries_total
  ${FROM_LINKS}`;

class Params {
  readonly values: unknown[];
  constructor(initial: unknown[]) {
    this.values = [...initial];
  }
  /** 追加一个绑定值，返回它的编号占位符 */
  add(value: unknown): string {
    this.values.push(value);
    return `?${this.values.length}`;
  }
}

function innerFilters(query: ShareLinkListQuery, params: Params): string {
  const clauses: string[] = [];
  if (query.rule_group_id !== undefined) clauses.push(`l.rule_group_id = ${params.add(query.rule_group_id)}`);
  if (query.mailbox_id !== undefined) {
    clauses.push(`EXISTS (SELECT 1 FROM share_link_mailboxes s WHERE s.link_id = l.id AND s.mailbox_id = ${params.add(query.mailbox_id)})`);
  }
  if (query.order_ref !== undefined) {
    clauses.push(`instr(lower(COALESCE(l.order_ref, '')), ${params.add(query.order_ref.toLowerCase())}) > 0`);
  }
  if (query.q !== undefined) {
    const keyword = params.add(query.q.toLowerCase());
    clauses.push(`(instr(lower(COALESCE(l.name, '')), ${keyword}) > 0 OR instr(lower(COALESCE(l.order_ref, '')), ${keyword}) > 0
      OR EXISTS (SELECT 1 FROM share_link_mailboxes s JOIN mailboxes m ON m.id = s.mailbox_id
                 WHERE s.link_id = l.id AND instr(m.address_lc, ${keyword}) > 0))`);
  }
  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}

function outerFilters(query: ShareLinkListQuery, params: Params, withCursor: boolean): string {
  const clauses: string[] = [];
  if (query.state !== undefined) clauses.push(`state = ${params.add(query.state)}`);
  if (withCursor && query.cursor !== undefined) clauses.push(`id < ${params.add(Number(query.cursor))}`);
  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}

function statsParams(now: number): unknown[] {
  return [now, now - LINK_DELIVERY_WINDOW_SEC];
}

/** id 倒序的游标分页，另带满足筛选条件的总数 */
export async function listShareLinkRows(
  db: D1Database,
  query: ShareLinkListQuery,
  now: number,
): Promise<{ rows: ShareLinkStatsRow[]; next_cursor: string | null; total: number }> {
  const limit = query.limit ?? LIST_PAGE_SIZE;
  const page = new Params(statsParams(now));
  const pageSql = `SELECT * FROM (${STATS_SELECT} ${innerFilters(query, page)}) ${outerFilters(query, page, true)}
    ORDER BY id DESC LIMIT ${page.add(limit + 1)}`;
  const count = new Params(statsParams(now));
  const countSql = `SELECT COUNT(*) AS n FROM (${STATS_SELECT} ${innerFilters(query, count)}) ${outerFilters(query, count, false)}`;
  const [pageResult, countResult] = await db.batch<ShareLinkStatsRow | { n: number }>([
    db.prepare(pageSql).bind(...page.values),
    db.prepare(countSql).bind(...count.values),
  ]);
  if (!pageResult || !countResult) throw new Error("D1 batch 返回的结果数不对");
  const rows = pageResult.results as ShareLinkStatsRow[];
  const total = (countResult.results[0] as { n: number } | undefined)?.n ?? 0;
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return { rows: pageRows, next_cursor: hasMore && last ? String(last.id) : null, total };
}

export async function findShareLinkStats(db: D1Database, id: number, now: number): Promise<ShareLinkStatsRow | null> {
  return db.prepare(`${STATS_SELECT} WHERE l.id = ?3`).bind(...statsParams(now), id).first<ShareLinkStatsRow>();
}

export async function findShareLinksStats(db: D1Database, ids: readonly number[], now: number): Promise<ShareLinkStatsRow[]> {
  const { results } = await db
    .prepare(`${STATS_SELECT} WHERE l.id IN (SELECT value FROM json_each(?3)) ORDER BY l.id`)
    .bind(...statsParams(now), JSON.stringify(ids))
    .all<ShareLinkStatsRow>();
  return results;
}

/** 公开接口：只按 token_hash 精确查找 */
export function findShareLinkByTokenHash(db: D1Database, tokenHash: string): Promise<ShareLinkRow | null> {
  return db.prepare(`SELECT ${LINK_COLUMNS} ${FROM_LINKS} WHERE l.token_hash = ?`).bind(tokenHash).first<ShareLinkRow>();
}

export async function listLinkMailboxes(db: D1Database, linkIds: readonly number[]): Promise<LinkMailboxRow[]> {
  if (linkIds.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT s.link_id, m.id, m.address, m.note, m.status FROM share_link_mailboxes s JOIN mailboxes m ON m.id = s.mailbox_id
       WHERE s.link_id IN (SELECT value FROM json_each(?)) ORDER BY m.id`,
    )
    .bind(JSON.stringify(linkIds))
    .all<LinkMailboxRow>();
  return results;
}

export type MailboxRef = { id: number; address: string; note: string | null; status: string; active_link_count: number };

/** 按 id 取收件地址，附带该地址上"生效中"的链接数（创建时提示用） */
export async function findMailboxRefs(db: D1Database, ids: readonly number[], now: number): Promise<MailboxRef[]> {
  const { results } = await db
    .prepare(
      `SELECT m.id, m.address, m.note, m.status,
         (SELECT COUNT(*) FROM share_link_mailboxes s JOIN share_links l ON l.id = s.link_id
          WHERE s.mailbox_id = m.id AND l.status = 'active' AND (l.expires_at IS NULL OR l.expires_at > ?2)) AS active_link_count
       FROM mailboxes m WHERE m.id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(ids), now)
    .all<MailboxRef>();
  return results;
}

export function ruleGroupExists(db: D1Database, id: number): Promise<{ id: number } | null> {
  return db.prepare("SELECT id FROM rule_groups WHERE id = ?").bind(id).first<{ id: number }>();
}
