import { loadLoginMethodFlags, remainingLoginMethodGuard } from "./login-methods";

// user_passkeys。credential_id 与 public_key 都是 base64url；transports 是 JSON 数组文本。

export type PasskeyRow = {
  id: number;
  user_id: number;
  name: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  created_at: number;
  last_used_at: number | null;
};

const COLUMNS = "id, user_id, name, credential_id, public_key, counter, transports, created_at, last_used_at";

export function parseTransports(row: Pick<PasskeyRow, "transports">): string[] {
  if (row.transports === null) return [];
  const value: unknown = JSON.parse(row.transports);
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("user_passkeys.transports 数据损坏");
  }
  return value;
}

export async function listUserPasskeys(db: D1Database, userId: number): Promise<PasskeyRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM user_passkeys WHERE user_id = ? ORDER BY id`)
    .bind(userId)
    .all<PasskeyRow>();
  return results;
}

export function findPasskeyByCredentialId(db: D1Database, credentialId: string): Promise<PasskeyRow | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM user_passkeys WHERE credential_id = ?`).bind(credentialId).first<PasskeyRow>();
}

export type NewPasskey = {
  user_id: number;
  name: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string[];
};

/** credential_id 重复时抛 D1 唯一约束错误，由调用方识别 */
export async function insertPasskey(db: D1Database, passkey: NewPasskey, now: number): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO user_passkeys (user_id, name, credential_id, public_key, counter, transports, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      passkey.user_id,
      passkey.name,
      passkey.credential_id,
      passkey.public_key,
      passkey.counter,
      JSON.stringify(passkey.transports),
      now,
    )
    .run();
  return result.meta.last_row_id;
}

export async function renamePasskey(db: D1Database, userId: number, id: number, name: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE user_passkeys SET name = ? WHERE id = ? AND user_id = ?")
    .bind(name, id, userId)
    .run();
  return result.meta.changes === 1;
}

/**
 * 比较并交换计数器：只有库里仍是校验时读到的旧值才更新。返回 false 表示并发的另一次登录先更新了。
 * 计数器恒为 0 的认证器（多数同步型通行密钥）每次都能更新成功，防重放靠一次性 challenge。
 */
export async function updatePasskeyCounter(
  db: D1Database,
  id: number,
  expected: number,
  next: number,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE user_passkeys SET counter = ?, last_used_at = ? WHERE id = ? AND counter = ?")
    .bind(next, now, id, expected)
    .run();
  return result.meta.changes === 1;
}

/** 用户自己删除：同一条语句里检查删除后仍有登录方式。返回 false 表示不存在或被保护拦下 */
export async function deleteOwnPasskey(db: D1Database, userId: number, id: number): Promise<boolean> {
  const guard = remainingLoginMethodGuard(userId, await loadLoginMethodFlags(db), { passkeyId: id });
  const result = await db
    .prepare(`DELETE FROM user_passkeys WHERE id = ? AND user_id = ? AND ${guard.sql}`)
    .bind(id, userId, ...guard.params)
    .run();
  return result.meta.changes === 1;
}

/** 管理员删除（单把或全部），不做登录方式保护；返回删除条数 */
export async function deletePasskeysByAdmin(db: D1Database, userId: number, id?: number): Promise<number> {
  const statement =
    id === undefined
      ? db.prepare("DELETE FROM user_passkeys WHERE user_id = ?").bind(userId)
      : db.prepare("DELETE FROM user_passkeys WHERE user_id = ? AND id = ?").bind(userId, id);
  return (await statement.run()).meta.changes;
}

export async function passkeyExists(db: D1Database, userId: number, id: number): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS ok FROM user_passkeys WHERE id = ? AND user_id = ?").bind(id, userId).first();
  return row !== null;
}
