import type { LoginMethod } from "@maillink/shared";

// 保存系统设置前的"防锁死"检查：设置不能把所有启用的管理员都挡在外面。
// 这两项检查都是读后判断，不与写入同事务；并发保存两个互相冲突的设置理论上可能漏过，管理员只有少数几个，可接受。

/**
 * 按给定的登录方式开关，是否至少有一个启用的管理员还有可用的登录方式：
 * 开放密码且他有密码，或开放通行密钥且他有通行密钥，或开放 OAuth 且他绑定了已启用提供方的身份。
 * 一条 EXISTS 查询；条件与 db/login-methods.ts 的 remainingLoginMethodGuard 一致（那边按单个用户 id 绑定，这里按管理员行关联）。
 */
export async function anyAdminCanLogIn(db: D1Database, methods: readonly LoginMethod[]): Promise<boolean> {
  const flag = (method: LoginMethod): number => (methods.includes(method) ? 1 : 0);
  const row = await db
    .prepare(
      `SELECT EXISTS (
         SELECT 1 FROM users a WHERE a.role = 'admin' AND a.status = 'active'
           AND ((?1 = 1 AND a.password_hash IS NOT NULL)
             OR (?2 = 1 AND EXISTS (SELECT 1 FROM user_passkeys p WHERE p.user_id = a.id))
             OR (?3 = 1 AND EXISTS (SELECT 1 FROM user_identities i JOIN oauth_providers o ON o.id = i.provider_id
                                    WHERE i.user_id = a.id AND o.enabled = 1)))
       ) AS ok`,
    )
    .bind(flag("password"), flag("passkey"), flag("oauth"))
    .first<{ ok: number }>();
  return row?.ok === 1;
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
