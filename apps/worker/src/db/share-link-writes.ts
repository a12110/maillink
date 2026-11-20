import type { ShareLinkStatus } from "@maillink/shared";

// share_links 的写操作。多步写一律放进一个 db.batch（D1 的 batch 是一个事务，全成或全败）。

export type ShareLinkWrite = {
  name: string | null;
  order_ref: string | null;
  public_title: string | null;
  public_note: string | null;
  rule_group_id: number;
  status: ShareLinkStatus;
  valid_from: number | null;
  expires_at: number | null;
  expire_after_first_access_sec: number | null;
  /** 已序列化的访问约束 JSON */
  access: string;
};

export type TokenColumns = { token_hash: string; token_enc: string; token_hint: string };

export type NewShareLink = ShareLinkWrite & TokenColumns & { mailbox_ids: number[] };

const WRITE_COLUMNS = [
  "name",
  "order_ref",
  "public_title",
  "public_note",
  "rule_group_id",
  "status",
  "valid_from",
  "expires_at",
  "expire_after_first_access_sec",
  "access",
] as const satisfies ReadonlyArray<keyof ShareLinkWrite>;

const INSERT_COLUMNS = [...WRITE_COLUMNS, "token_hash", "token_enc", "token_hint"] as const;

/**
 * 一次插入多个链接及其收件地址：整组以 JSON 数组作为单个参数传入，固定 3 条语句（不随数量增长，
 * 不会撞上单次调用的查询数上限），前两条在同一个 batch 里，要么全部建成要么一个都不建。返回顺序与入参一致的 id。
 */
export async function insertShareLinks(db: D1Database, links: readonly NewShareLink[], actorId: number, now: number): Promise<number[]> {
  const payload = JSON.stringify(links);
  const selects = INSERT_COLUMNS.map((column) => `json_extract(value, '$.${column}')`).join(", ");
  await db.batch([
    db
      .prepare(
        `INSERT INTO share_links (${INSERT_COLUMNS.join(", ")}, created_by, created_at, updated_at)
         SELECT ${selects}, ?2, ?3, ?3 FROM json_each(?1)`,
      )
      .bind(payload, actorId, now),
    db
      .prepare(
        `INSERT INTO share_link_mailboxes (link_id, mailbox_id)
         SELECT l.id, j.value
         FROM (SELECT json_extract(value, '$.token_hash') AS token_hash, json_extract(value, '$.mailbox_ids') AS mailbox_ids FROM json_each(?1)) x
         JOIN share_links l ON l.token_hash = x.token_hash, json_each(x.mailbox_ids) j`,
      )
      .bind(payload),
  ]);
  const { results } = await db
    .prepare("SELECT id, token_hash FROM share_links WHERE token_hash IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(links.map((link) => link.token_hash)))
    .all<{ id: number; token_hash: string }>();
  const byHash = new Map(results.map((row) => [row.token_hash, row.id]));
  return links.map((link) => {
    const id = byHash.get(link.token_hash);
    if (id === undefined) throw new Error("插入的链接没有找到对应 id");
    return id;
  });
}

/** 按白名单列更新；没有要改的列时只刷新 updated_at。返回是否命中这一行 */
export async function updateShareLink(db: D1Database, id: number, fields: Partial<ShareLinkWrite>, now: number): Promise<boolean> {
  const columns = WRITE_COLUMNS.filter((column) => fields[column] !== undefined);
  const sets = columns.map((column, index) => `${column} = ?${index + 1}`);
  const values = columns.map((column) => fields[column] ?? null);
  const sql = `UPDATE share_links SET ${[...sets, `updated_at = ?${columns.length + 1}`].join(", ")} WHERE id = ?${columns.length + 2}`;
  const result = await db.prepare(sql).bind(...values, now, id).run();
  return result.meta.changes > 0;
}

export async function deleteShareLink(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM share_links WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}

export async function replaceToken(db: D1Database, id: number, token: TokenColumns, now: number): Promise<boolean> {
  const result = await db
    .prepare("UPDATE share_links SET token_hash = ?, token_enc = ?, token_hint = ?, updated_at = ? WHERE id = ?")
    .bind(token.token_hash, token.token_enc, token.token_hint, now, id)
    .run();
  return result.meta.changes > 0;
}

export type ResetFlags = { reset_anchor: boolean; reset_devices: boolean; reset_deliveries: boolean };

function resetStatements(db: D1Database, id: number, flags: ResetFlags, now: number): D1PreparedStatement[] {
  const statements = [
    db
      .prepare("UPDATE share_links SET anchor_reset_at = CASE WHEN ?1 THEN ?2 ELSE anchor_reset_at END, updated_at = ?2 WHERE id = ?3")
      .bind(flags.reset_anchor ? 1 : 0, now, id),
  ];
  if (flags.reset_devices) statements.push(db.prepare("DELETE FROM link_visitors WHERE link_id = ?").bind(id));
  if (flags.reset_deliveries) statements.push(db.prepare("DELETE FROM link_deliveries WHERE link_id = ?").bind(id));
  return statements;
}

/** 单独重置起始时间 / 设备 / 取码记录（一个事务） */
export async function resetShareLink(db: D1Database, id: number, flags: ResetFlags, now: number): Promise<void> {
  await db.batch(resetStatements(db, id, flags, now));
}

/** 换绑收件地址，可同时重置（一个事务） */
export async function rebindShareLink(db: D1Database, id: number, mailboxIds: readonly number[], flags: ResetFlags, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM share_link_mailboxes WHERE link_id = ?").bind(id),
    db
      .prepare("INSERT INTO share_link_mailboxes (link_id, mailbox_id) SELECT ?1, value FROM json_each(?2)")
      .bind(id, JSON.stringify(mailboxIds)),
    ...resetStatements(db, id, flags, now),
  ]);
}

export type BatchAction =
  | { action: "pause" | "resume" | "revoke" }
  | { action: "extend"; extend_sec: number }
  | { action: "set_rule_group"; rule_group_id: number };

/**
 * 整批一条条件 UPDATE（id 列表以 JSON 传入，RETURNING 拿到真正改动的 id）。条件里写清楚"可以执行"的前提：
 * 撤销是终态；暂停只对生效中的，恢复只对暂停的；延长只对有截止时间的。没改动的原因由调用方再查。
 */
function batchStatement(db: D1Database, idsJson: string, action: BatchAction, now: number): D1PreparedStatement {
  const target = "id IN (SELECT value FROM json_each(?1))";
  switch (action.action) {
    case "pause":
      return db.prepare(`UPDATE share_links SET status = 'paused', updated_at = ?2 WHERE ${target} AND status = 'active' RETURNING id`).bind(idsJson, now);
    case "resume":
      return db.prepare(`UPDATE share_links SET status = 'active', updated_at = ?2 WHERE ${target} AND status = 'paused' RETURNING id`).bind(idsJson, now);
    case "revoke":
      return db.prepare(`UPDATE share_links SET status = 'revoked', updated_at = ?2 WHERE ${target} AND status != 'revoked' RETURNING id`).bind(idsJson, now);
    case "set_rule_group":
      return db
        .prepare(`UPDATE share_links SET rule_group_id = ?3, updated_at = ?2 WHERE ${target} AND status != 'revoked' RETURNING id`)
        .bind(idsJson, now, action.rule_group_id);
    case "extend":
      // 已过期的从现在起算：max(截止, 现在) + 延长量；首次访问后有效期换算成新的秒数
      return db
        .prepare(
          `UPDATE share_links SET
             expires_at = CASE WHEN expires_at IS NULL THEN NULL ELSE MAX(expires_at, ?2) + ?3 END,
             expire_after_first_access_sec = CASE
               WHEN expire_after_first_access_sec IS NULL THEN NULL
               WHEN first_access_at IS NULL THEN expire_after_first_access_sec + ?3
               ELSE MAX(first_access_at + expire_after_first_access_sec, ?2) - first_access_at + ?3 END,
             updated_at = ?2
           WHERE ${target} AND status != 'revoked' AND (expires_at IS NOT NULL OR expire_after_first_access_sec IS NOT NULL)
           RETURNING id`,
        )
        .bind(idsJson, now, action.extend_sec);
  }
}

/** 返回真正被改动的 id 集合 */
export async function applyBatchAction(db: D1Database, ids: readonly number[], action: BatchAction, now: number): Promise<Set<number>> {
  const { results } = await batchStatement(db, JSON.stringify(ids), action, now).all<{ id: number }>();
  return new Set(results.map((row) => row.id));
}

export async function findLinkStatuses(db: D1Database, ids: readonly number[]): Promise<Map<number, { status: ShareLinkStatus; has_deadline: boolean }>> {
  const { results } = await db
    .prepare(
      `SELECT id, status, (expires_at IS NOT NULL OR expire_after_first_access_sec IS NOT NULL) AS has_deadline
       FROM share_links WHERE id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(ids))
    .all<{ id: number; status: ShareLinkStatus; has_deadline: number }>();
  return new Map(results.map((row) => [row.id, { status: row.status, has_deadline: row.has_deadline === 1 }]));
}
