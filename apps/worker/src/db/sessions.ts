import type { UserRole, UserStatus } from "@maillink/shared";

// sessions 表。库里只有 Cookie 值的 SHA-256（id_hash），拿到库也无法冒用会话。

export type SessionRow = {
  id_hash: string;
  user_id: number;
  auth_methods: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  ip: string | null;
  user_agent: string | null;
};

export type NewSession = Omit<SessionRow, "last_seen_at"> & { last_seen_at?: number };

export type SessionWithUser = SessionRow & {
  username: string;
  display_name: string | null;
  email_lc: string | null;
  role: UserRole;
  status: UserStatus;
};

export async function insertSession(db: D1Database, session: NewSession): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sessions (id_hash, user_id, auth_methods, created_at, last_seen_at, expires_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      session.id_hash,
      session.user_id,
      session.auth_methods,
      session.created_at,
      session.last_seen_at ?? session.created_at,
      session.expires_at,
      session.ip,
      session.user_agent,
    )
    .run();
}

export function findSessionWithUser(db: D1Database, idHash: string): Promise<SessionWithUser | null> {
  return db
    .prepare(
      `SELECT s.id_hash, s.user_id, s.auth_methods, s.created_at, s.last_seen_at, s.expires_at, s.ip, s.user_agent,
              u.username, u.display_name, u.email_lc, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id_hash = ?`,
    )
    .bind(idHash)
    .first<SessionWithUser>();
}

export async function touchSession(db: D1Database, idHash: string, now: number): Promise<void> {
  await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?").bind(now, idHash).run();
}

export async function deleteSession(db: D1Database, idHash: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(idHash).run();
}

/** 删除某用户的会话，可排除一个（如改密码时保留当前会话）。返回删除条数 */
export async function deleteUserSessions(
  db: D1Database,
  userId: number,
  exceptIdHash?: string,
): Promise<number> {
  const statement =
    exceptIdHash === undefined
      ? db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId)
      : db.prepare("DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?").bind(userId, exceptIdHash);
  const result = await statement.run();
  return result.meta.changes;
}

export async function listUserSessions(db: D1Database, userId: number): Promise<SessionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id_hash, user_id, auth_methods, created_at, last_seen_at, expires_at, ip, user_agent
       FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC, created_at DESC`,
    )
    .bind(userId)
    .all<SessionRow>();
  return results;
}
