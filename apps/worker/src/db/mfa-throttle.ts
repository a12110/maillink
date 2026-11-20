import { MFA_USER_FAILURE_MAX, MFA_USER_FAILURE_WINDOW_SEC, MFA_USER_LOCK_SEC } from "../constants";

// users.mfa_fail_count / mfa_fail_window_start / mfa_locked_until：按用户的第二因素尝试计数。
// 先占用一次尝试再校验（并发请求也无法超过上限），成功后清零；窗口过期后重新计数。
// 达到上限的那次尝试仍会被校验，同时写入锁定期并把计数归零，锁定结束后从新窗口开始。

export type AttemptReservation = { allowed: true; triggeredLock: boolean } | { allowed: false; lockedUntil: number };

const WINDOW_EXPIRED = "(mfa_fail_window_start IS NULL OR mfa_fail_window_start <= ?)";
const NEXT_COUNT = `(CASE WHEN ${WINDOW_EXPIRED} THEN 1 ELSE mfa_fail_count + 1 END)`;

export async function reserveMfaAttempt(db: D1Database, userId: number, now: number): Promise<AttemptReservation> {
  const windowFloor = now - MFA_USER_FAILURE_WINDOW_SEC;
  // UPDATE 的 SET 表达式都读更新前的列值，所以"新计数"在三处各算一次
  const row = await db
    .prepare(
      `UPDATE users SET
         mfa_fail_count = CASE WHEN ${NEXT_COUNT} >= ? THEN 0 ELSE ${NEXT_COUNT} END,
         mfa_fail_window_start = CASE WHEN ${NEXT_COUNT} >= ? THEN NULL WHEN ${WINDOW_EXPIRED} THEN ? ELSE mfa_fail_window_start END,
         mfa_locked_until = CASE WHEN ${NEXT_COUNT} >= ? THEN ? ELSE NULL END
       WHERE id = ? AND (mfa_locked_until IS NULL OR mfa_locked_until <= ?)
       RETURNING mfa_locked_until`,
    )
    .bind(
      windowFloor,
      MFA_USER_FAILURE_MAX,
      windowFloor,
      windowFloor,
      MFA_USER_FAILURE_MAX,
      windowFloor,
      now,
      windowFloor,
      MFA_USER_FAILURE_MAX,
      now + MFA_USER_LOCK_SEC,
      userId,
      now,
    )
    .first<{ mfa_locked_until: number | null }>();
  if (row) return { allowed: true, triggeredLock: row.mfa_locked_until !== null };
  const locked = await db.prepare("SELECT mfa_locked_until FROM users WHERE id = ?").bind(userId).first<{ mfa_locked_until: number | null }>();
  if (!locked) throw new Error(`用户 ${userId} 不存在`);
  return { allowed: false, lockedUntil: locked.mfa_locked_until ?? now };
}

/** 第二因素通过：清零计数并解除锁定 */
export async function clearMfaFailures(db: D1Database, userId: number): Promise<void> {
  await db
    .prepare("UPDATE users SET mfa_fail_count = 0, mfa_fail_window_start = NULL, mfa_locked_until = NULL WHERE id = ?")
    .bind(userId)
    .run();
}
