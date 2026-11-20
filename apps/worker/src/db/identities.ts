import { loadLoginMethodFlags, remainingLoginMethodGuard } from "./login-methods";
import type { NewUser } from "./users";

// user_identities：OAuth 绑定。唯一键 (provider_id, subject)，不用邮箱当键（03 §4.4）。

export type IdentityRow = {
  id: number;
  user_id: number;
  provider_id: number;
  subject: string;
  email: string | null;
  display_name: string | null;
  created_at: number;
  last_login_at: number | null;
};

export type IdentityWithProvider = IdentityRow & { slug: string; provider_name: string; icon: string | null };

const COLUMNS = "id, user_id, provider_id, subject, email, display_name, created_at, last_login_at";

export function findIdentity(db: D1Database, providerId: number, subject: string): Promise<IdentityRow | null> {
  return db
    .prepare(`SELECT ${COLUMNS} FROM user_identities WHERE provider_id = ? AND subject = ?`)
    .bind(providerId, subject)
    .first<IdentityRow>();
}

export type NewIdentity = Omit<IdentityRow, "id" | "user_id" | "created_at" | "last_login_at">;

const INSERT_IDENTITY = `INSERT INTO user_identities (user_id, provider_id, subject, email, display_name, created_at, last_login_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

/** (provider_id, subject) 已存在时抛 D1 唯一约束错误。lastLoginAt 为 null 表示只绑定、未登录 */
export async function insertIdentity(
  db: D1Database,
  userId: number,
  identity: NewIdentity,
  now: number,
  lastLoginAt: number | null,
): Promise<number> {
  const result = await db
    .prepare(INSERT_IDENTITY)
    .bind(userId, identity.provider_id, identity.subject, identity.email, identity.display_name, now, lastLoginAt)
    .run();
  return result.meta.last_row_id;
}

/** 每次通过该身份登录时刷新 IdP 侧的邮箱与显示名（只做展示，不参与任何判定） */
export async function touchIdentity(
  db: D1Database,
  id: number,
  profile: { email: string | null; display_name: string | null },
  now: number,
): Promise<void> {
  await db
    .prepare("UPDATE user_identities SET email = ?, display_name = ?, last_login_at = ? WHERE id = ?")
    .bind(profile.email, profile.display_name, now, id)
    .run();
}

export async function listUserIdentities(db: D1Database, userId: number): Promise<IdentityWithProvider[]> {
  const { results } = await db
    .prepare(
      `SELECT i.id, i.user_id, i.provider_id, i.subject, i.email, i.display_name, i.created_at, i.last_login_at,
              o.slug, o.name AS provider_name, o.icon
       FROM user_identities i JOIN oauth_providers o ON o.id = i.provider_id
       WHERE i.user_id = ? ORDER BY i.id`,
    )
    .bind(userId)
    .all<IdentityWithProvider>();
  return results;
}

/** 用户自己解绑：同一条语句里检查解绑后仍有登录方式 */
export async function deleteOwnIdentity(db: D1Database, userId: number, id: number): Promise<boolean> {
  const guard = remainingLoginMethodGuard(userId, await loadLoginMethodFlags(db), { identityId: id });
  const result = await db
    .prepare(`DELETE FROM user_identities WHERE id = ? AND user_id = ? AND ${guard.sql}`)
    .bind(id, userId, ...guard.params)
    .run();
  return result.meta.changes === 1;
}

/** 管理员解绑（单个或全部），不做登录方式保护；返回删除条数 */
export async function deleteIdentitiesByAdmin(db: D1Database, userId: number, id?: number): Promise<number> {
  const statement =
    id === undefined
      ? db.prepare("DELETE FROM user_identities WHERE user_id = ?").bind(userId)
      : db.prepare("DELETE FROM user_identities WHERE user_id = ? AND id = ?").bind(userId, id);
  return (await statement.run()).meta.changes;
}

export async function identityExists(db: D1Database, userId: number, id: number): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS ok FROM user_identities WHERE id = ? AND user_id = ?").bind(id, userId).first();
  return row !== null;
}

/**
 * 自动关联的候选账号，规则见 auth/oauth-link.ts 顶部注释：邮箱完全相同、邮箱由管理员设置、
 * 普通用户、启用中、尚未绑定该提供方的任何身份。
 */
export function findAutoLinkCandidate(
  db: D1Database,
  email: string,
  providerId: number,
): Promise<{ id: number } | null> {
  return db
    .prepare(
      `SELECT u.id FROM users u
       WHERE u.email_lc = ? AND u.email_admin_set = 1 AND u.role = 'user' AND u.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.provider_id = ?)`,
    )
    .bind(email, providerId)
    .first<{ id: number }>();
}

/**
 * OAuth 自动建号：新用户与绑定在同一事务里写入（绑定冲突时用户也不会留下）。
 * 用户名或邮箱冲突时抛 D1 唯一约束错误。
 */
export async function insertUserWithIdentity(
  db: D1Database,
  user: NewUser,
  identity: NewIdentity,
  now: number,
): Promise<number> {
  const [created] = await db.batch([
    db
      .prepare(
        `INSERT INTO users (username, username_lc, email_lc, display_name, role, status, password_hash, email_admin_set,
                            created_at, updated_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .bind(user.username, user.username.toLowerCase(), user.email, user.display_name, user.role, user.status, user.password_hash, now, now, now),
    db
      .prepare(
        `INSERT INTO user_identities (user_id, provider_id, subject, email, display_name, created_at, last_login_at)
         VALUES (last_insert_rowid(), ?, ?, ?, ?, ?, ?)`,
      )
      .bind(identity.provider_id, identity.subject, identity.email, identity.display_name, now, now),
  ]);
  if (!created) throw new Error("建号事务没有返回结果");
  return created.meta.last_row_id;
}
