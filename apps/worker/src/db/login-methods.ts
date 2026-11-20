import { getSettings } from "./settings";

// "至少保留一种登录方式"（03 §6）：密码、通行密钥、已启用提供方的 OAuth 绑定，三者至少有一个。
// 只算设置 auth.login_methods 里开放的方式（全站关掉通行密钥时，通行密钥不算可用方式）。
// 写成 SQL 条件与删除放在同一条语句里，并发删除两把通行密钥也不会把最后一种登录方式删掉。
// 两步验证是第二因素，不算登录方式。

/** 不排除任何行时用的占位 id（自增主键从 1 开始） */
const NO_EXCLUDE = 0;

export type LoginMethodExclusion = { passkeyId?: number; identityId?: number };
export type LoginMethodFlags = { password: boolean; passkey: boolean; oauth: boolean };

export async function loadLoginMethodFlags(db: D1Database): Promise<LoginMethodFlags> {
  const { "auth.login_methods": methods } = await getSettings(db, ["auth.login_methods"]);
  return { password: methods.includes("password"), passkey: methods.includes("passkey"), oauth: methods.includes("oauth") };
}

function flag(value: boolean): number {
  return value ? 1 : 0;
}

/**
 * 返回 SQL 条件：排除 exclude 指定的那把通行密钥 / 那个绑定之后，用户仍有开放中的登录方式。
 * 绑定参数顺序与占位符一致，调用方直接展开。
 */
export function remainingLoginMethodGuard(
  userId: number,
  flags: LoginMethodFlags,
  exclude: LoginMethodExclusion = {},
): { sql: string; params: unknown[] } {
  return {
    sql: `((? = 1 AND EXISTS (SELECT 1 FROM users lm_u WHERE lm_u.id = ? AND lm_u.password_hash IS NOT NULL))
      OR (? = 1 AND EXISTS (SELECT 1 FROM user_passkeys lm_p WHERE lm_p.user_id = ? AND lm_p.id <> ?))
      OR (? = 1 AND EXISTS (SELECT 1 FROM user_identities lm_i JOIN oauth_providers lm_o ON lm_o.id = lm_i.provider_id
                 WHERE lm_i.user_id = ? AND lm_i.id <> ? AND lm_o.enabled = 1)))`,
    params: [
      flag(flags.password),
      userId,
      flag(flags.passkey),
      userId,
      exclude.passkeyId ?? NO_EXCLUDE,
      flag(flags.oauth),
      userId,
      exclude.identityId ?? NO_EXCLUDE,
    ],
  };
}

export async function hasAnyLoginMethod(db: D1Database, userId: number): Promise<boolean> {
  const guard = remainingLoginMethodGuard(userId, await loadLoginMethodFlags(db));
  const row = await db
    .prepare(`SELECT ${guard.sql} AS ok`)
    .bind(...guard.params)
    .first<{ ok: number }>();
  return row?.ok === 1;
}
