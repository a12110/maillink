import type { AdminMailboxListQuery, MailboxStatus } from "@maillink/shared";
import { LIST_PAGE_SIZE } from "../constants";

// mailboxes / mailbox_tags 的读写（APP_DB，全部参数化）。批量写入用 json_each 传数组，避开绑定参数个数上限。

export type MailboxRow = {
  id: number;
  address: string;
  label: string | null;
  note: string | null;
  status: MailboxStatus;
  created_at: number;
  updated_at: number;
  /** JSON 数组文本 */
  tags: string;
  link_count: number;
  grant_count: number;
};

const SELECT_MAILBOXES = `
  SELECT m.id, m.address, m.label, m.note, m.status, m.created_at, m.updated_at,
    (SELECT json_group_array(tag) FROM (SELECT t.tag FROM mailbox_tags t WHERE t.mailbox_id = m.id ORDER BY t.tag)) AS tags,
    (SELECT COUNT(*) FROM share_link_mailboxes s WHERE s.mailbox_id = m.id) AS link_count,
    (SELECT COUNT(*) FROM user_mailbox_grants g WHERE g.mailbox_id = m.id) AS grant_count
  FROM mailboxes m`;

type FilterOptions = { withCursor: boolean; withStatus: boolean };

function buildFilter(query: AdminMailboxListQuery, options: FilterOptions): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.q !== undefined) {
    // instr 做字面子串匹配，不用 LIKE（免去通配符转义，也没有 50 字节模式上限）
    const keyword = query.q.toLowerCase();
    clauses.push(
      "(instr(m.address_lc, ?) > 0 OR instr(lower(COALESCE(m.label, '')), ?) > 0 OR instr(lower(COALESCE(m.note, '')), ?) > 0)",
    );
    params.push(keyword, keyword, keyword);
  }
  if (query.tag !== undefined) {
    clauses.push("EXISTS (SELECT 1 FROM mailbox_tags t WHERE t.mailbox_id = m.id AND t.tag = ?)");
    params.push(query.tag);
  }
  if (query.has_link !== undefined) {
    clauses.push(`${query.has_link ? "" : "NOT "}EXISTS (SELECT 1 FROM share_link_mailboxes s WHERE s.mailbox_id = m.id)`);
  }
  if (options.withStatus && query.status !== undefined) {
    clauses.push("m.status = ?");
    params.push(query.status);
  }
  if (options.withCursor && query.cursor !== undefined) {
    clauses.push("m.id < ?");
    params.push(Number(query.cursor));
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export type MailboxListPage = {
  rows: MailboxRow[];
  next_cursor: string | null;
  total: number;
  active_count: number;
  disabled_count: number;
};

type StatusCounts = { active: number | null; disabled: number | null };

/** id 倒序的游标分页，另带满足筛选条件的总数，以及去掉 status 筛选后的启用数、停用数（同一 batch，口径一致） */
export async function listMailboxRows(db: D1Database, query: AdminMailboxListQuery): Promise<MailboxListPage> {
  const limit = query.limit ?? LIST_PAGE_SIZE;
  const page = buildFilter(query, { withCursor: true, withStatus: true });
  const count = buildFilter(query, { withCursor: false, withStatus: true });
  const byStatus = buildFilter(query, { withCursor: false, withStatus: false });
  const [list, total, statuses] = await db.batch<MailboxRow | { total: number } | StatusCounts>([
    db.prepare(`${SELECT_MAILBOXES} ${page.where} ORDER BY m.id DESC LIMIT ?`).bind(...page.params, limit + 1),
    db.prepare(`SELECT COUNT(*) AS total FROM mailboxes m ${count.where}`).bind(...count.params),
    db
      .prepare(`SELECT SUM(m.status = 'active') AS active, SUM(m.status = 'disabled') AS disabled FROM mailboxes m ${byStatus.where}`)
      .bind(...byStatus.params),
  ]);
  const rows = (list?.results ?? []) as MailboxRow[];
  const pageRows = rows.slice(0, limit);
  const counts = statuses?.results[0] as StatusCounts | undefined;
  return {
    rows: pageRows,
    next_cursor: pageCursor(rows.length > limit, pageRows),
    total: readTotal(total),
    // 没有任何行时 SUM 为 NULL
    active_count: counts?.active ?? 0,
    disabled_count: counts?.disabled ?? 0,
  };
}

/** 全部标签及使用次数：次数降序、标签升序；多取一行判断是否超出上限 */
export async function listMailboxTagCounts(db: D1Database, max: number): Promise<{ items: Array<{ tag: string; count: number }>; truncated: boolean }> {
  const { results } = await db
    .prepare("SELECT tag, COUNT(*) AS count FROM mailbox_tags GROUP BY tag ORDER BY count DESC, tag ASC LIMIT ?")
    .bind(max + 1)
    .all<{ tag: string; count: number }>();
  return { items: results.slice(0, max), truncated: results.length > max };
}

function pageCursor(hasMore: boolean, rows: readonly MailboxRow[]): string | null {
  const last = rows.at(-1);
  return hasMore && last ? String(last.id) : null;
}

function readTotal(result: D1Result<unknown> | undefined): number {
  const row = result?.results[0] as { total: number } | undefined;
  return row?.total ?? 0;
}

export function findMailboxRow(db: D1Database, id: number): Promise<MailboxRow | null> {
  return db.prepare(`${SELECT_MAILBOXES} WHERE m.id = ?`).bind(id).first<MailboxRow>();
}

/** 已存在的 address_lc → id */
export async function findMailboxIdsByAddressLc(db: D1Database, addressesLc: readonly string[]): Promise<Map<string, number>> {
  if (addressesLc.length === 0) return new Map();
  const { results } = await db
    .prepare("SELECT id, address_lc FROM mailboxes WHERE address_lc IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify(addressesLc))
    .all<{ id: number; address_lc: string }>();
  return new Map(results.map((row) => [row.address_lc, row.id]));
}

export type NewMailbox = { address: string; address_lc: string; note: string | null; tags: string[] };

/**
 * 批量新增：已存在的 address_lc 跳过（并发导入同一地址时不报错），RETURNING 只返回本语句真正插入的行，
 * 标签只按这些 id 写入——并发或重复导入抢先写入的地址不会被补打标签。
 * 两条语句不在同一事务：标签写入失败时异常原样抛出（500），已新增的地址保留、没有标签，可重新导入或批量打标签补齐。
 * 返回 address_lc → 新 id。
 */
export async function insertMailboxes(db: D1Database, entries: readonly NewMailbox[], actorId: number, now: number): Promise<Map<string, number>> {
  if (entries.length === 0) return new Map();
  const rows = JSON.stringify(entries.map((entry) => ({ a: entry.address, l: entry.address_lc, n: entry.note })));
  const { results } = await db
    .prepare(
      `INSERT INTO mailboxes (address, address_lc, note, status, created_by, created_at, updated_at)
       SELECT json_extract(value, '$.a'), json_extract(value, '$.l'), json_extract(value, '$.n'), 'active', ?2, ?3, ?3
       FROM json_each(?1) WHERE true
       ON CONFLICT(address_lc) DO NOTHING
       RETURNING id, address_lc`,
    )
    .bind(rows, actorId, now)
    .all<{ id: number; address_lc: string }>();
  const inserted = new Map(results.map((row) => [row.address_lc, row.id]));
  const pairs = entries.flatMap((entry) => {
    const id = inserted.get(entry.address_lc);
    return id === undefined ? [] : entry.tags.map((tag): [number, string] => [id, tag]);
  });
  if (pairs.length > 0) {
    await db
      .prepare("INSERT OR IGNORE INTO mailbox_tags (mailbox_id, tag) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1)")
      .bind(JSON.stringify(pairs))
      .run();
  }
  return inserted;
}

/** 删除前留证用：存在的收件地址的地址与引用数 */
export async function findMailboxRows(db: D1Database, ids: readonly number[]): Promise<MailboxRow[]> {
  const { results } = await db
    .prepare(`${SELECT_MAILBOXES} WHERE m.id IN (SELECT value FROM json_each(?1)) ORDER BY m.id`)
    .bind(JSON.stringify(ids))
    .all<MailboxRow>();
  return results;
}

export type MailboxUpdate = { label?: string | null; note?: string | null; status?: MailboxStatus; tags?: string[] };

/** 改资料与状态；tags 给出时整体替换。返回是否找到该行 */
export async function updateMailbox(db: D1Database, id: number, patch: MailboxUpdate, now: number): Promise<boolean> {
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];
  for (const key of ["label", "note", "status"] as const) {
    if (patch[key] === undefined) continue;
    sets.push(`${key} = ?`);
    params.push(patch[key]);
  }
  const statements = [db.prepare(`UPDATE mailboxes SET ${sets.join(", ")} WHERE id = ?`).bind(...params, id)];
  if (patch.tags !== undefined) {
    statements.push(
      db.prepare("DELETE FROM mailbox_tags WHERE mailbox_id = ?").bind(id),
      db
        .prepare("INSERT OR IGNORE INTO mailbox_tags (mailbox_id, tag) SELECT ?1, value FROM json_each(?2) WHERE EXISTS (SELECT 1 FROM mailboxes WHERE id = ?1)")
        .bind(id, JSON.stringify(patch.tags)),
    );
  }
  const [result] = await db.batch(statements);
  return (result?.meta.changes ?? 0) > 0;
}

/** 返回实际删除的 id */
export async function deleteMailboxes(db: D1Database, ids: readonly number[]): Promise<number[]> {
  const { results } = await db
    .prepare("DELETE FROM mailboxes WHERE id IN (SELECT value FROM json_each(?1)) RETURNING id")
    .bind(JSON.stringify(ids))
    .all<{ id: number }>();
  return results.map((row) => row.id);
}

/** 返回实际更新的 id */
export async function setMailboxStatus(db: D1Database, ids: readonly number[], status: MailboxStatus, now: number): Promise<number[]> {
  const { results } = await db
    .prepare("UPDATE mailboxes SET status = ?2, updated_at = ?3 WHERE id IN (SELECT value FROM json_each(?1)) RETURNING id")
    .bind(JSON.stringify(ids), status, now)
    .all<{ id: number }>();
  return results.map((row) => row.id);
}

/** 现有标签：id → 标签集合（只含存在的收件地址） */
export async function findMailboxTags(db: D1Database, ids: readonly number[]): Promise<Map<number, Set<string>>> {
  const { results } = await db
    .prepare(
      `SELECT m.id, t.tag FROM mailboxes m LEFT JOIN mailbox_tags t ON t.mailbox_id = m.id
       WHERE m.id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(ids))
    .all<{ id: number; tag: string | null }>();
  const tags = new Map<number, Set<string>>();
  for (const row of results) {
    const set = tags.get(row.id) ?? new Set<string>();
    if (row.tag !== null) set.add(row.tag);
    tags.set(row.id, set);
  }
  return tags;
}

/** 批量打标签：pairs 为 (mailbox_id, tag)，已有的忽略 */
export async function addMailboxTags(db: D1Database, pairs: ReadonlyArray<[number, string]>, now: number): Promise<void> {
  if (pairs.length === 0) return;
  const json = JSON.stringify(pairs.map(([id, tag]) => ({ i: id, t: tag })));
  const ids = JSON.stringify([...new Set(pairs.map(([id]) => id))]);
  await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO mailbox_tags (mailbox_id, tag) SELECT json_extract(value, '$.i'), json_extract(value, '$.t') FROM json_each(?1)")
      .bind(json),
    db.prepare("UPDATE mailboxes SET updated_at = ?2 WHERE id IN (SELECT value FROM json_each(?1))").bind(ids, now),
  ]);
}

export async function removeMailboxTags(db: D1Database, ids: readonly number[], tags: readonly string[], now: number): Promise<void> {
  const idJson = JSON.stringify(ids);
  await db.batch([
    db
      .prepare(
        "DELETE FROM mailbox_tags WHERE mailbox_id IN (SELECT value FROM json_each(?1)) AND tag IN (SELECT value FROM json_each(?2))",
      )
      .bind(idJson, JSON.stringify(tags)),
    db.prepare("UPDATE mailboxes SET updated_at = ?2 WHERE id IN (SELECT value FROM json_each(?1))").bind(idJson, now),
  ]);
}
