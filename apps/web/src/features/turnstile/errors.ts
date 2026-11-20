import { describeErrorWith } from "../../lib/api-error-text";
import type { ErrorTexts } from "../../lib/api-error-text";

/** 带 Turnstile 的入口（登录、注册、取件）共用的错误说明 */
export const TURNSTILE_ERROR_TEXTS: ErrorTexts = {
  turnstile_failed: "人机验证没有通过，请重新完成验证后再试。",
  turnstile_unavailable: "人机验证服务暂时不可用，请稍后重试。",
  turnstile_not_configured: "管理员尚未配好人机验证（site key 或 secret），暂时无法继续，请联系管理员。",
  rate_limited: "操作过于频繁，请稍后再试。",
};

export function describeTurnstileError(error: unknown): { message: string; detail: string } {
  return describeErrorWith(TURNSTILE_ERROR_TEXTS, error);
}
