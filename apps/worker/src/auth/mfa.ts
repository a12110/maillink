import type { Context } from "hono";
import { z } from "zod";
import type { LoginResponse, MfaMethod } from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { nowSec } from "../clock";
import { PENDING_MFA_MAX_ATTEMPTS, PENDING_MFA_SEC } from "../constants";
import { markFlowTokenConsumed, registerFlowAttempt } from "../db/flow-tokens";
import { findUserById, touchLastLogin } from "../db/users";
import type { UserRow } from "../db/users";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { HTTP_UNAUTHORIZED } from "../http-status";
import { randomBytes, toBase64Url } from "./crypto";
import { FLOW_COOKIES, clearFlowCookie, readFlowCookie, setFlowCookie } from "./flow-cookies";
import { startSession } from "./session";
import { reserveSecondFactor, secondFactorFailed, secondFactorSucceeded } from "./second-factor-throttle";
import type { SecondFactor } from "./second-factors";
import { FlowTokenError, signToken, verifySignedToken } from "./signed-token";

// 登录第二步。第一步（密码，或开启了"OAuth 后仍需 2FA"时的 OAuth）通过后不发会话，
// 改发签名 Cookie pending_auth：{ typ, uid, m: 已完成的方式, jti, exp }。
// 约束：5 分钟过期；每个 pending_auth 最多尝试 PENDING_MFA_MAX_ATTEMPTS 次（先计数后校验）；成功一次即作废。

const PENDING_TYP = "pending_auth";
const JTI_BYTES = 16;
const BASE_METHODS_MAX = 4;

const pendingAuthSchema = z.object({
  typ: z.literal(PENDING_TYP),
  exp: z.number().int(),
  jti: z.string().min(1),
  uid: z.number().int().positive(),
  m: z.array(z.string().min(1)).min(1).max(BASE_METHODS_MAX),
});
type PendingAuth = z.infer<typeof pendingAuthSchema>;

export function newJti(): string {
  return toBase64Url(randomBytes(JTI_BYTES));
}

function pendingInvalid(): ApiError {
  return new ApiError(HTTP_UNAUTHORIZED, "mfa_pending_invalid", "登录验证已失效，请重新登录");
}

/** 发 pending_auth 并返回 mfa_required 响应体 */
export async function issuePendingAuth(
  c: Context<AppEnv>,
  userId: number,
  baseMethods: string[],
): Promise<Extract<LoginResponse, { status: "mfa_required" }>> {
  const exp = nowSec() + PENDING_MFA_SEC;
  const token = await signToken(c.env, { typ: PENDING_TYP, exp, jti: newJti(), uid: userId, m: baseMethods } satisfies PendingAuth);
  setFlowCookie(c, FLOW_COOKIES.pendingAuth, token);
  return { status: "mfa_required", methods: ["totp", "recovery"], expires_at: exp };
}

async function readPendingAuth(c: Context<AppEnv>): Promise<PendingAuth> {
  const token = readFlowCookie(c, FLOW_COOKIES.pendingAuth);
  if (!token) throw pendingInvalid();
  try {
    return await verifySignedToken(c.env, token, PENDING_TYP, pendingAuthSchema, nowSec());
  } catch (error) {
    if (!(error instanceof FlowTokenError)) throw error;
    clearFlowCookie(c, FLOW_COOKIES.pendingAuth);
    throw pendingInvalid();
  }
}

async function loadEligibleUser(db: D1Database, userId: number): Promise<UserRow | null> {
  const user = await findUserById(db, userId);
  if (!user || user.status !== "active" || user.totp_enabled_at === null) return null;
  return user;
}

async function auditPendingRejected(c: Context<AppEnv>, pending: PendingAuth, method: MfaMethod, reason: string): Promise<void> {
  await recordAudit(c, {
    action: AUDIT_ACTIONS.mfaFailed,
    actorUserId: null,
    targetType: "user",
    targetId: pending.uid,
    detail: { method, reason },
  });
}

/** 登记本 pending_auth 的一次尝试并取出用户；令牌已用完、用户不可用时清 Cookie 并 401 */
async function admitAttempt(c: Context<AppEnv>, pending: PendingAuth, method: MfaMethod): Promise<{ user: UserRow; attempt: number }> {
  const db = c.env.APP_DB;
  const attempt = await registerFlowAttempt(db, pending.jti, "pending_auth", pending.exp, PENDING_MFA_MAX_ATTEMPTS);
  const user = attempt === null ? null : await loadEligibleUser(db, pending.uid);
  if (attempt === null || user === null) {
    clearFlowCookie(c, FLOW_COOKIES.pendingAuth);
    await auditPendingRejected(c, pending, method, attempt === null ? "exhausted" : "ineligible");
    throw pendingInvalid();
  }
  return { user, attempt };
}

function wrongFactor(c: Context<AppEnv>, method: MfaMethod, attempt: number): ApiError {
  const left = PENDING_MFA_MAX_ATTEMPTS - attempt;
  if (left <= 0) {
    clearFlowCookie(c, FLOW_COOKIES.pendingAuth);
    return pendingInvalid();
  }
  const what = method === "totp" ? "验证码错误" : "恢复码无效或已使用";
  return new ApiError(HTTP_UNAUTHORIZED, "invalid_mfa_code", `${what}，还可尝试 ${left} 次`);
}

/**
 * 用第二因素换取会话。顺序：pending_auth 计数 → 按用户计数（锁定中 429）→ 只读校验因素 →
 * 抢占 pending_auth → 消耗因素 → 发会话。任何失败都不发会话。
 */
export async function completeSecondFactor(c: Context<AppEnv>, method: MfaMethod, factor: SecondFactor): Promise<void> {
  const db = c.env.APP_DB;
  const pending = await readPendingAuth(c);
  const { user, attempt } = await admitAttempt(c, pending, method);
  const slot = await reserveSecondFactor(c, user.id);

  const check = await factor(user.id);
  if (check.result !== "ok") {
    await secondFactorFailed(c, user.id, slot, { action: AUDIT_ACTIONS.mfaFailed, detail: { method, reason: check.result, attempt } });
    throw wrongFactor(c, method, attempt);
  }
  // 先抢占令牌再消耗因素：并发的另一个请求在这里失败，不会白白用掉恢复码或时间步
  if (!(await markFlowTokenConsumed(db, pending.jti, nowSec()))) throw pendingInvalid();
  clearFlowCookie(c, FLOW_COOKIES.pendingAuth);
  if (!(await check.consume())) {
    await secondFactorFailed(c, user.id, slot, { action: AUDIT_ACTIONS.mfaFailed, detail: { method, reason: "replayed", attempt } });
    throw pendingInvalid();
  }
  await secondFactorSucceeded(c, user.id);

  const methods = [...pending.m, method];
  await startSession(c, user.id, methods);
  await touchLastLogin(db, user.id, nowSec());
  await recordAudit(c, {
    action: AUDIT_ACTIONS.loginSuccess,
    actorUserId: user.id,
    targetType: "user",
    targetId: user.id,
    detail: { method: methods.join(",") },
  });
}
