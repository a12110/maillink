// auth_flow_tokens：短时流程令牌的一次性消费与尝试次数。令牌本体在 Cookie 里，这里只有 jti。
// 每个操作都是单条原子语句，并发请求下"只能用一次""最多 N 次"依然成立。

export type FlowTokenPurpose = "pending_auth" | "passkey_reg" | "passkey_auth" | "oauth_flow";

async function purgeExpired(db: D1Database, now: number): Promise<void> {
  await db.prepare("DELETE FROM auth_flow_tokens WHERE expires_at <= ?").bind(now).run();
}

/**
 * 一次性消费：第一次调用返回 true，之后（含并发的另一请求）都返回 false。
 * 顺带清掉已过期的行（过期令牌在签名校验处就会被拒，不再需要记录）。
 */
export async function consumeFlowToken(
  db: D1Database,
  jti: string,
  purpose: FlowTokenPurpose,
  expiresAt: number,
  now: number,
): Promise<boolean> {
  await purgeExpired(db, now);
  const result = await db
    .prepare(
      `INSERT INTO auth_flow_tokens (jti, purpose, attempts, consumed_at, expires_at) VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(jti) DO UPDATE SET consumed_at = excluded.consumed_at
       WHERE auth_flow_tokens.consumed_at IS NULL AND auth_flow_tokens.purpose = excluded.purpose`,
    )
    .bind(jti, purpose, now, expiresAt)
    .run();
  return result.meta.changes === 1;
}

/**
 * 登记一次尝试。返回本次是第几次；令牌已被消费或次数已达上限时返回 null（不再计数）。
 * 先计数再校验验证码，并发爆破也无法超过上限。
 */
export async function registerFlowAttempt(
  db: D1Database,
  jti: string,
  purpose: FlowTokenPurpose,
  expiresAt: number,
  maxAttempts: number,
): Promise<number | null> {
  const row = await db
    .prepare(
      `INSERT INTO auth_flow_tokens (jti, purpose, attempts, expires_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(jti) DO UPDATE SET attempts = auth_flow_tokens.attempts + 1
       WHERE auth_flow_tokens.consumed_at IS NULL AND auth_flow_tokens.attempts < ?
         AND auth_flow_tokens.purpose = excluded.purpose
       RETURNING attempts`,
    )
    .bind(jti, purpose, expiresAt, maxAttempts)
    .first<{ attempts: number }>();
  return row ? row.attempts : null;
}

/** 尝试成功后标记已消费；返回 false 表示已被并发请求先消费 */
export async function markFlowTokenConsumed(db: D1Database, jti: string, now: number): Promise<boolean> {
  const result = await db
    .prepare("UPDATE auth_flow_tokens SET consumed_at = ? WHERE jti = ? AND consumed_at IS NULL")
    .bind(now, jti)
    .run();
  return result.meta.changes === 1;
}
