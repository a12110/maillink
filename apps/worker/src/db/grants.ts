import type { AdminGrantListQuery, MailboxStatus, UserRole } from "@maillink/shared";
import { LIST_PAGE_SIZE } from "../constants";

// user_mailbox_grants 的读写（APP_DB，全部参数化）。批量写入用 json_each 传数组，避开绑定参数个数上限。

export type GrantRow = {
  id: number;
  user_id: number;
  username: string;
  mailbox_id: number;
  address: string;
  mailbox_status: MailboxStatus;
  rule_group_id: number | null;
  rule_group_name: string | null;
  expires_at: number | null;
  first_access_at: number | null;
  created_at: number;
};

const SELECT_GRANTS = `
  SELECT g.id, g.user_id, u.username, g.mailbox_id, m.address, m.status AS mailbox_status,
    g.rule_group_id, r.name AS rule_group_name, g.expires_at, g.first_access_at, g.created_at
  FROM user_mailbox_grants g
  JOIN users u ON u.id = g.user_id
  JOIN mailboxes m ON m.id = g.mailbox_id
  LEFT JOIN rule_groups r ON r.id = g.rule_group_id`;

/** id 倒序的游标分页；user_id / mailbox_id 至少给一个由路由边界保证 */
export async function listGrantRows(
  db: D1Database,
  query: AdminGrantListQuery,
): Promise<{ rows: GrantRow[]; next_cursor: string | null }> {
  const limit = query.limit ?? LIST_PAGE_SIZE;
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.user_id !== undefined) {
    clauses.push("g.user_id = ?");
    params.push(query.user_id);
  }
  if (query.mailbox_id !== undefined) {
    clauses.push("g.mailbox_id = ?");
    params.push(query.mailbox_id);
  }
  if (query.cursor !== undefined) {
    clauses.push("g.id < ?");
    params.push(Number(query.cursor));
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const { results } = await db
    .prepare(`${SELECT_GRANTS} ${where} ORDER BY g.id DESC LIMIT ?`)
    .bind(...params, limit + 1)
    .all<GrantRow>();
  const rows = results.slice(0, limit);
  const last = rows.at(-1);
  return { rows, next_cursor: results.length > limit && last ? String(last.id) : null };
}

export function findGrantRow(db: D1Database, id: number): Promise<GrantRow | null> {
  return db.prepare(`${SELECT_GRANTS} WHERE g.id = ?`).bind(id).first<GrantRow>();
}

/** 批量授权前取已有授权：用户集合 × 收件地址集合里已存在的 */
export async function findGrantsForPairs(db: D1Database, userIds: readonly number[], mailboxIds: readonly number[]): Promise<GrantRow[]> {
  const { results } = await db
    .prepare(
      `${SELECT_GRANTS}
       WHERE g.user_id IN (SELECT value FROM json_each(?1)) AND g.mailbox_id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(JSON.stringify(userIds), JSON.stringify(mailboxIds))
    .all<GrantRow>();
  return results;
}

/** 存在的用户：id → 角色 */
export async function findUserRoles(db: D1Database, ids: readonly number[]): Promise<Map<number, UserRole>> {
  const { results } = await db
    .prepare("SELECT id, role FROM users WHERE id IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify(ids))
    .all<{ id: number; role: UserRole }>();
  return new Map(results.map((row) => [row.id, row.role]));
}

export async function findExistingMailboxIds(db: D1Database, ids: readonly number[]): Promise<Set<number>> {
  const { results } = await db
    .prepare("SELECT id FROM mailboxes WHERE id IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify(ids))
    .all<{ id: number }>();
  return new Set(results.map((row) => row.id));
}

export type GrantTarget = { user_id: number; mailbox_id: number };
export type GrantSettings = { rule_group_id: number | null; expires_at: number | null };

/**
 * 新增授权：(user_id, mailbox_id) 已存在的跳过（并发批量授权不报错），RETURNING 只返回本语句真正插入的行。
 * 返回 "user_id:mailbox_id" → 新 id。
 */
export async function insertGrants(
  db: D1Database,
  targets: readonly GrantTarget[],
  settings: GrantSettings,
  actorId: number,
  now: number,
): Promise<Map<string, number>> {
  if (targets.length === 0) return new Map();
  const pairs = JSON.stringify(targets.map((target) => [target.user_id, target.mailbox_id]));
  const { results } = await db
    .prepare(
      `INSERT INTO user_mailbox_grants (user_id, mailbox_id, rule_group_id, expires_at, created_by, created_at)
       SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), ?2, ?3, ?4, ?5 FROM json_each(?1) WHERE true
       ON CONFLICT(user_id, mailbox_id) DO NOTHING
       RETURNING id, user_id, mailbox_id`,
    )
    .bind(pairs, settings.rule_group_id, settings.expires_at, actorId, now)
    .all<{ id: number; user_id: number; mailbox_id: number }>();
  return new Map(results.map((row) => [pairKey(row.user_id, row.mailbox_id), row.id]));
}

export function pairKey(userId: number, mailboxId: number): string {
  return `${userId}:${mailboxId}`;
}

/** 批量改规则组与过期时间；返回实际更新的授权 id */
export async function updateGrants(db: D1Database, ids: readonly number[], settings: GrantSettings): Promise<number[]> {
  if (ids.length === 0) return [];
  const { results } = await db
    .prepare("UPDATE user_mailbox_grants SET rule_group_id = ?2, expires_at = ?3 WHERE id IN (SELECT value FROM json_each(?1)) RETURNING id")
    .bind(JSON.stringify(ids), settings.rule_group_id, settings.expires_at)
    .all<{ id: number }>();
  return results.map((row) => row.id);
}

/** 单条修改，只改给出的字段（null 是有意义的值：完整访问 / 永不过期）。返回是否找到该行 */
export async function patchGrant(db: D1Database, id: number, patch: Partial<GrantSettings>): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of ["rule_group_id", "expires_at"] as const) {
    if (patch[key] === undefined) continue;
    sets.push(`${key} = ?`);
    params.push(patch[key]);
  }
  if (sets.length === 0) throw new RangeError("patchGrant 至少要改一个字段");
  const result = await db
    .prepare(`UPDATE user_mailbox_grants SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...params, id)
    .run();
  return result.meta.changes > 0;
}

export async function deleteGrant(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM user_mailbox_grants WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}

// ---- 用户侧 ----

export type EffectiveGrantRow = {
  id: number;
  mailbox_id: number;
  address: string;
  label: string | null;
  rule_group_id: number | null;
  /** rule_group_id 不为空而这里为 null 是数据异常（外键本应保证存在），调用方按失效处理 */
  rule_group_config: string | null;
  expires_at: number | null;
  first_access_at: number | null;
  created_at: number;
};

/** 有效 = 未过期且收件地址启用。用户本身的启用状态由会话鉴权保证 */
const EFFECTIVE_CONDITION = "g.user_id = ?1 AND (g.expires_at IS NULL OR g.expires_at > ?2) AND m.status = 'active'";

export async function listEffectiveGrantRows(db: D1Database, userId: number, now: number): Promise<EffectiveGrantRow[]> {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.mailbox_id, m.address, m.label, g.rule_group_id, r.config AS rule_group_config,
         g.expires_at, g.first_access_at, g.created_at
       FROM user_mailbox_grants g
       JOIN mailboxes m ON m.id = g.mailbox_id
       LEFT JOIN rule_groups r ON r.id = g.rule_group_id
       WHERE ${EFFECTIVE_CONDITION} ORDER BY g.id`,
    )
    .bind(userId, now)
    .all<EffectiveGrantRow>();
  return results;
}

/**
 * 写入授权的首次访问时间（只写一次：`first_access_at IS NULL` 才更新，并发请求不会互相覆盖）。
 * grantId 为 null 时处理该用户全部有效授权（"全部"列表覆盖了它们）。无效授权不写。
 */
export async function markGrantsFirstAccess(db: D1Database, userId: number, grantId: number | null, now: number): Promise<void> {
  await db
    .prepare(
      `UPDATE user_mailbox_grants AS g SET first_access_at = ?2
       WHERE g.first_access_at IS NULL AND (?3 IS NULL OR g.id = ?3)
         AND EXISTS (SELECT 1 FROM mailboxes m WHERE m.id = g.mailbox_id AND m.status = 'active')
         AND g.user_id = ?1 AND (g.expires_at IS NULL OR g.expires_at > ?2)`,
    )
    .bind(userId, now, grantId)
    .run();
}
