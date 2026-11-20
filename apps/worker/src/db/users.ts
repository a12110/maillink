import type { UserRole, UserStatus } from "@maillink/shared";

// users 表的写入与按键读取。所有 SQL 参数化；列表与统计查询在 admin-users.ts。

export type UserRow = {
  id: number;
  username: string;
  username_lc: string;
  email_lc: string | null;
  display_name: string | null;
  role: UserRole;
  status: UserStatus;
  password_hash: string | null;
  /** 非 NULL 表示已启用两步验证 */
  totp_enabled_at: number | null;
  /** 1 = 当前邮箱由管理员设置（OAuth 自动关联只认这类邮箱，见 auth/oauth-link.ts） */
  email_admin_set: number;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
};

// 刻意不查 totp_secret_enc / totp_last_step：只有 db/totp.ts 读写它们
const USER_COLUMNS =
  "id, username, username_lc, email_lc, display_name, role, status, password_hash, totp_enabled_at, email_admin_set, created_at, updated_at, last_login_at";

export type NewUser = {
  username: string;
  display_name: string | null;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  /** NULL = 不设密码（只能用通行密钥或 OAuth 登录的账号，如 OAuth 自动建号） */
  password_hash: string | null;
  /** 邮箱是否由管理员设置；缺省视为否 */
  email_admin_set?: boolean;
};

export type UserPatch = {
  username?: string;
  display_name?: string | null;
  email?: string | null;
  role?: UserRole;
  status?: UserStatus;
  /** 与 email 一起传：管理员设置为 true，用户自己改为 false */
  email_admin_set?: boolean;
};

export async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
  return row?.total ?? 0;
}

export function findUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
}

export function findUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE username_lc = ?`)
    .bind(username.toLowerCase())
    .first<UserRow>();
}

const INSERT_USER_VALUES = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?";

function insertParams(user: NewUser, now: number): unknown[] {
  return [
    user.username,
    user.username.toLowerCase(),
    user.email,
    user.display_name,
    user.role,
    user.status,
    user.password_hash,
    user.email !== null && user.email_admin_set === true ? 1 : 0,
    now,
    now,
  ];
}

const INSERT_COLUMNS =
  "username, username_lc, email_lc, display_name, role, status, password_hash, email_admin_set, created_at, updated_at";

/** 唯一约束冲突时抛出 D1 错误，由调用方用 uniqueViolationTarget 识别 */
export async function insertUser(db: D1Database, user: NewUser, now: number): Promise<number> {
  const result = await db
    .prepare(`INSERT INTO users (${INSERT_COLUMNS}) VALUES (${INSERT_USER_VALUES})`)
    .bind(...insertParams(user, now))
    .run();
  return result.meta.last_row_id;
}

/** 仅当 users 表仍为空时插入首个管理员（单条语句，并发初始化时只有一个会成功）。返回 null 表示已有用户 */
export async function insertFirstAdmin(
  db: D1Database,
  user: Omit<NewUser, "role" | "status" | "display_name" | "email" | "email_admin_set"> & { password_hash: string },
  now: number,
): Promise<number | null> {
  const full: NewUser = { ...user, display_name: null, email: null, role: "admin", status: "active" };
  const result = await db
    .prepare(
      `INSERT INTO users (${INSERT_COLUMNS}) SELECT ${INSERT_USER_VALUES} WHERE NOT EXISTS (SELECT 1 FROM users)`,
    )
    .bind(...insertParams(full, now))
    .run();
  return result.meta.changes > 0 ? result.meta.last_row_id : null;
}

/**
 * "最后一个启用的管理员"保护，写成 SQL 条件，与改动在同一条语句里执行（并发下也不会把最后一个管理员改没）。
 * `next` 为改动后的角色/状态表达式（绑定参数或沿用列值）；删除时传 null，表示改动后不再是管理员。
 */
function lastAdminGuard(
  id: number,
  next: { role: string; status: string } | null,
): { sql: string; params: unknown[] } {
  const stillActiveAdmin = next ? `OR (${next.role} = 'admin' AND ${next.status} = 'active')` : "";
  return {
    sql: `AND (NOT (role = 'admin' AND status = 'active') ${stillActiveAdmin}
      OR EXISTS (SELECT 1 FROM users other WHERE other.id <> ? AND other.role = 'admin' AND other.status = 'active'))`,
    params: [id],
  };
}

/** 邮箱被改动时才更新来源标记；清空邮箱时标记一并清零 */
function emailAdminSetValue(patch: UserPatch): number | undefined {
  if (patch.email === undefined) return undefined;
  return patch.email !== null && patch.email_admin_set === true ? 1 : 0;
}

/**
 * 更新用户。返回 false 表示没有行被改：用户不存在，或被"最后一个管理员"保护拦下（由调用方区分）。
 * 唯一约束冲突时抛 D1 错误。
 */
export async function updateUser(db: D1Database, id: number, patch: UserPatch, now: number): Promise<boolean> {
  const assignments: Array<[string, unknown]> = [
    ["username", patch.username],
    ["username_lc", patch.username?.toLowerCase()],
    ["display_name", patch.display_name],
    ["email_lc", patch.email],
    ["email_admin_set", emailAdminSetValue(patch)],
    ["role", patch.role],
    ["status", patch.status],
  ];
  const changed = assignments.filter(([, value]) => value !== undefined);
  const sets = [...changed.map(([column]) => `${column} = ?`), "updated_at = ?"];
  const params: unknown[] = [...changed.map(([, value]) => value), now, id];

  let guardSql = "";
  if (patch.role !== undefined || patch.status !== undefined) {
    const guard = lastAdminGuard(id, {
      role: patch.role !== undefined ? "?" : "role",
      status: patch.status !== undefined ? "?" : "status",
    });
    guardSql = guard.sql;
    // 占位符出现顺序：先 role 再 status（若是绑定参数），最后是 other.id
    if (patch.role !== undefined) params.push(patch.role);
    if (patch.status !== undefined) params.push(patch.status);
    params.push(...guard.params);
  }

  const result = await db
    .prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ? ${guardSql}`)
    .bind(...params)
    .run();
  return result.meta.changes > 0;
}

/** 删除用户（外键级联删除会话、凭据、授权）。返回 false：不存在或被"最后一个管理员"保护拦下 */
export async function deleteUser(db: D1Database, id: number): Promise<boolean> {
  const guard = lastAdminGuard(id, null);
  const result = await db
    .prepare(`DELETE FROM users WHERE id = ? ${guard.sql}`)
    .bind(id, ...guard.params)
    .run();
  // D1 的 meta.changes 把外键级联删除的行（会话、凭据等）也算进去，所以不能和 1 比较
  return result.meta.changes > 0;
}

export async function setPasswordHash(
  db: D1Database,
  id: number,
  passwordHash: string,
  now: number,
): Promise<void> {
  await db
    .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .bind(passwordHash, now, id)
    .run();
}

export async function touchLastLogin(db: D1Database, id: number, now: number): Promise<void> {
  await db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now, id).run();
}
