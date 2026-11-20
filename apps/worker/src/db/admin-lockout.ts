import type { LoginMethod } from "@maillink/shared";
import { remainingLoginMethodGuard } from "./login-methods";

// 保存系统设置前的"防锁死"检查：设置不能把所有启用的管理员都挡在外面。
// 这两项检查都是读后判断，不与写入同事务；并发保存两个互相冲突的设置理论上可能漏过，管理员只有少数几个，可接受。

/** 启用的管理员 id */
async function activeAdminIds(db: D1Database): Promise<number[]> {
  const { results } = await db.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id").all<{ id: number }>();
  return results.map((row) => row.id);
}

/**
 * 按给定的登录方式开关，是否至少有一个启用的管理员还有可用的登录方式：
 * 开放密码且他有密码，或开放通行密钥且他有通行密钥，或开放 OAuth 且他绑定了已启用提供方的身份。
 */
export async function anyAdminCanLogIn(db: D1Database, methods: readonly LoginMethod[]): Promise<boolean> {
  const flags = { password: methods.includes("password"), passkey: methods.includes("passkey"), oauth: methods.includes("oauth") };
  for (const id of await activeAdminIds(db)) {
    const guard = remainingLoginMethodGuard(id, flags);
    const row = await db
      .prepare(`SELECT ${guard.sql} AS ok`)
      .bind(...guard.params)
      .first<{ ok: number }>();
    if (row?.ok === 1) return true;
  }
  return false;
}

/**
 * 开启"管理员强制 2FA"时，是否至少有一个启用的管理员能满足它：已启用 TOTP，
 * 或登记了通行密钥且通行密钥登录开放（通行密钥登录视为已完成多因素）。
 */
export async function anyAdminHasSecondFactor(db: D1Database, methods: readonly LoginMethod[]): Promise<boolean> {
  const passkeyOpen = methods.includes("passkey") ? 1 : 0;
  const row = await db
    .prepare(
      `SELECT EXISTS (
         SELECT 1 FROM users u WHERE u.role = 'admin' AND u.status = 'active'
           AND (u.totp_enabled_at IS NOT NULL
                OR (?1 = 1 AND EXISTS (SELECT 1 FROM user_passkeys p WHERE p.user_id = u.id)))
       ) AS ok`,
    )
    .bind(passkeyOpen)
    .first<{ ok: number }>();
  return row?.ok === 1;
}
