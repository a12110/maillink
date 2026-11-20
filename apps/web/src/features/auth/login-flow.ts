import type { MfaMethod } from "@maillink/shared";
import { isApiError } from "../../api/errors";
import { describeRateLimit } from "../../lib/auth-messages";

/** 登录页的状态机：密码步 ⇄ 第二步（TOTP / 恢复码）。纯函数，不依赖 React，便于测试。 */
export type LoginStep = { kind: "password" } | { kind: "mfa"; method: MfaMethod };

/** 第二步提交失败的分类：决定留在原地、回到密码步，还是只显示提示 */
export type MfaFailure =
  /** invalid_mfa_code：可以重试，message 带剩余次数 */
  | { kind: "retry"; message: string }
  /** mfa_pending_invalid：5 分钟过期 / 次数用完 / 账号不可用，必须重新输入密码 */
  | { kind: "restart"; message: string }
  /** mfa_locked（429）：按用户的失败上限触发的锁定 */
  | { kind: "locked"; message: string }
  /** rate_limited（429）：IP 级限流，Retry-After 秒后再试 */
  | { kind: "rate_limited"; message: string; retryAfterSec: number | null }
  | { kind: "error"; error: unknown };

export function classifyMfaError(error: unknown): MfaFailure {
  if (isApiError(error, "invalid_mfa_code")) return { kind: "retry", message: error.message };
  if (isApiError(error, "mfa_pending_invalid")) return { kind: "restart", message: error.message };
  if (isApiError(error, "mfa_locked")) return { kind: "locked", message: error.message };
  if (isApiError(error, "rate_limited")) {
    return { kind: "rate_limited", message: describeRateLimit(error.retryAfterSec), retryAfterSec: error.retryAfterSec ?? null };
  }
  return { kind: "error", error };
}

export type LoginNotice =
  | { kind: "mfa"; failure: MfaFailure }
  | { kind: "oauth"; code: string; provider: string | null }
  | { kind: "password_error"; error: unknown };

export type LoginState = { step: LoginStep; notice: LoginNotice | null };

export type LoginEvent =
  | { type: "mfa_required" }
  | { type: "use_method"; method: MfaMethod }
  | { type: "back_to_password" }
  | { type: "mfa_failed"; failure: MfaFailure }
  | { type: "password_failed"; error: unknown }
  | { type: "oauth_result"; code: string; provider: string | null };

const PASSWORD_STEP: LoginStep = { kind: "password" };

export const INITIAL_LOGIN_STATE: LoginState = { step: PASSWORD_STEP, notice: null };

export function loginReducer(state: LoginState, event: LoginEvent): LoginState {
  switch (event.type) {
    case "mfa_required":
      return { step: { kind: "mfa", method: "totp" }, notice: null };
    case "use_method":
      return state.step.kind === "mfa" ? { step: { kind: "mfa", method: event.method }, notice: null } : state;
    case "back_to_password":
      return INITIAL_LOGIN_STATE;
    case "password_failed":
      return { step: PASSWORD_STEP, notice: { kind: "password_error", error: event.error } };
    case "mfa_failed":
      // 只有 pending_auth 失效才回到密码步；验证码错误、被锁、被限流都留在第二步（再回密码步也无济于事）
      return {
        step: event.failure.kind === "restart" ? PASSWORD_STEP : state.step,
        notice: { kind: "mfa", failure: event.failure },
      };
    case "oauth_result":
      return event.code === "mfa_required"
        ? { step: { kind: "mfa", method: "totp" }, notice: null }
        : { step: PASSWORD_STEP, notice: { kind: "oauth", code: event.code, provider: event.provider } };
  }
}

/** 第二步提交用哪个接口 */
export function mfaEndpoint(method: MfaMethod): "mfaTotp" | "mfaRecovery" {
  return method === "totp" ? "mfaTotp" : "mfaRecovery";
}
