// users 表里 TOTP 相关的列（totp_secret_enc / totp_enabled_at / totp_last_step）与恢复码表。
// 每个状态转换都是带条件的单条语句，并发启用、并发使用同一时间步的码都只有一个能成功。

export type TotpState = {
  totp_secret_enc: string | null;
  totp_enabled_at: number | null;
  totp_last_step: number | null;
};

export function findTotpState(db: D1Database, userId: number): Promise<TotpState | null> {
  return db
    .prepare("SELECT totp_secret_enc, totp_enabled_at, totp_last_step FROM users WHERE id = ?")
    .bind(userId)
    .first<TotpState>();
}

/**
 * 启用 2FA 与写入恢复码放在同一事务：仅当尚未启用时写入密钥（启用用的那个时间步同时记为已用），
 * 恢复码的删除与插入都以"用户行里正是这次写入的密文"为条件（密文带随机 IV，全局唯一），
 * 所以已启用时整批不生效。返回 false 表示已启用或用户不存在。
 */
export async function enableTotpWithRecoveryCodes(
  db: D1Database,
  userId: number,
  enable: { secretEnc: string; usedStep: number; recoveryHashes: string[] },
  now: number,
): Promise<boolean> {
  const applied = "EXISTS (SELECT 1 FROM users WHERE id = ? AND totp_secret_enc = ?)";
  const [update] = await db.batch([
    db
      .prepare(
        `UPDATE users SET totp_secret_enc = ?, totp_enabled_at = ?, totp_last_step = ?, updated_at = ?
         WHERE id = ? AND totp_secret_enc IS NULL`,
      )
      .bind(enable.secretEnc, now, enable.usedStep, now, userId),
    db.prepare(`DELETE FROM user_recovery_codes WHERE user_id = ? AND ${applied}`).bind(userId, userId, enable.secretEnc),
    ...enable.recoveryHashes.map((hash) =>
      db
        .prepare(`INSERT INTO user_recovery_codes (user_id, code_hash) SELECT ?, ? WHERE ${applied}`)
        .bind(userId, hash, userId, enable.secretEnc),
    ),
  ]);
  return (update?.meta.changes ?? 0) === 1;
}

/** 关闭 2FA：清密钥与恢复码（同一事务）。返回 false 表示原本就没启用 */
export async function disableTotp(db: D1Database, userId: number, now: number): Promise<boolean> {
  const [update] = await db.batch([
    db
      .prepare(
        `UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL, updated_at = ?
         WHERE id = ? AND totp_secret_enc IS NOT NULL`,
      )
      .bind(now, userId),
    db.prepare("DELETE FROM user_recovery_codes WHERE user_id = ?").bind(userId),
  ]);
  return (update?.meta.changes ?? 0) === 1;
}

/**
 * 占用一个时间步：只有比上次成功的时间步更新才写入。返回 false 表示重放（同一或更早时间步）
 * 或 2FA 已被关闭。校验通过后必须调用它，才算这次验证码有效。
 */
export async function claimTotpStep(db: D1Database, userId: number, step: number): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE users SET totp_last_step = ?
       WHERE id = ? AND totp_secret_enc IS NOT NULL AND (totp_last_step IS NULL OR totp_last_step < ?)`,
    )
    .bind(step, userId, step)
    .run();
  return result.meta.changes === 1;
}

/** 用新的一组恢复码替换旧的（同一事务） */
export async function replaceRecoveryCodes(db: D1Database, userId: number, hashes: string[]): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM user_recovery_codes WHERE user_id = ?").bind(userId),
    ...hashes.map((hash) =>
      db.prepare("INSERT INTO user_recovery_codes (user_id, code_hash) VALUES (?, ?)").bind(userId, hash),
    ),
  ]);
}

/** 找一个未用过的恢复码（只读，不消耗）；返回行 id */
export async function findUnusedRecoveryCode(db: D1Database, userId: number, hash: string): Promise<number | null> {
  const row = await db
    .prepare("SELECT id FROM user_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL LIMIT 1")
    .bind(userId, hash)
    .first<{ id: number }>();
  return row?.id ?? null;
}

/** 消耗一个恢复码；返回 false 表示已被并发请求先用掉 */
export async function useRecoveryCodeById(db: D1Database, id: number, now: number): Promise<boolean> {
  const result = await db
    .prepare("UPDATE user_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL")
    .bind(now, id)
    .run();
  return result.meta.changes === 1;
}

export async function countUnusedRecoveryCodes(db: D1Database, userId: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
