import type { Context } from "hono";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { nowSec } from "../clock";
import { MFA_USER_FAILURE_MAX, MFA_USER_FAILURE_WINDOW_SEC, MFA_USER_LOCK_SEC } from "../constants";
import { clearMfaFailures, reserveMfaAttempt } from "../db/mfa-throttle";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { HTTP_TOO_MANY_REQUESTS } from "../http-status";

// 按用户 id（跨 IP、跨 pending_auth）的第二因素失败上限。用法：
//   const slot = await reserveSecondFactor(c, userId)   // 锁定中直接 429 mfa_locked
//   校验成功 → await secondFactorSucceeded(c, userId)；失败 → await secondFactorFailed(c, userId, slot, detail)
// 每个 pending_auth 的 5 次上限仍然保留；IP 维度的限流（M7）是另一层。

const SECONDS_PER_MINUTE = 60;

export type SecondFactorSlot = { triggeredLock: boolean };

export function mfaLockedError(lockedUntil: number, now: number): ApiError {
  const minutes = Math.max(1, Math.ceil((lockedUntil - now) / SECONDS_PER_MINUTE));
  return new ApiError(HTTP_TOO_MANY_REQUESTS, "mfa_locked", `验证失败次数过多，请约 ${minutes} 分钟后再试`);
}

export async function reserveSecondFactor(c: Context<AppEnv>, userId: number): Promise<SecondFactorSlot> {
  const now = nowSec();
  const reservation = await reserveMfaAttempt(c.env.APP_DB, userId, now);
  if (!reservation.allowed) throw mfaLockedError(reservation.lockedUntil, now);
  return { triggeredLock: reservation.triggeredLock };
}

export async function secondFactorSucceeded(c: Context<AppEnv>, userId: number): Promise<void> {
  await clearMfaFailures(c.env.APP_DB, userId);
}

/** 记一次失败；这次尝试触发了锁定时另写一条 auth.mfa_locked 审计 */
export async function secondFactorFailed(
  c: Context<AppEnv>,
  userId: number,
  slot: SecondFactorSlot,
  failure: { action: typeof AUDIT_ACTIONS.mfaFailed | typeof AUDIT_ACTIONS.reauthFailed; detail: Record<string, unknown> },
): Promise<void> {
  await recordAudit(c, { action: failure.action, actorUserId: null, targetType: "user", targetId: userId, detail: failure.detail });
  if (!slot.triggeredLock) return;
  await recordAudit(c, {
    action: AUDIT_ACTIONS.mfaLocked,
    actorUserId: null,
    targetType: "user",
    targetId: userId,
    detail: { max: MFA_USER_FAILURE_MAX, window_sec: MFA_USER_FAILURE_WINDOW_SEC, lock_sec: MFA_USER_LOCK_SEC },
  });
}
