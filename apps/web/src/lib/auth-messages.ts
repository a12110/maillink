import { isApiError } from "../api/errors";
import { describeError } from "./messages";

const HTTP_TOO_MANY_REQUESTS = 429;

/** 429 限流：Retry-After 是该限流窗口的上界，不是精确剩余时间，所以写“约” */
export function describeRateLimit(retryAfterSec: number | undefined): string {
  if (retryAfterSec === undefined) return "请求太频繁了，请稍等一会儿再试。";
  return `请求太频繁了，请约 ${retryAfterSec} 秒后再试。`;
}

/**
 * 认证相关错误的文案。后端的 invalid_mfa_code / mfa_locked / reauth_* / last_login_method 等错误消息本身就是
 * 面向用户的中文（含剩余次数、锁定分钟数），原样展示；这里只补需要读响应头的限流。错误码仍随文案带出。
 */
export function describeAuthError(error: unknown): { message: string; detail: string } {
  if (isApiError(error, "last_login_method")) {
    return {
      message: "这是你唯一的登录方式，不能删除。请先设置密码、注册其他通行密钥或绑定其他第三方账号，再回来操作。",
      detail: `${error.code} · HTTP ${error.status}`,
    };
  }
  if (isApiError(error, "rate_limited") || (isApiError(error) && error.status === HTTP_TOO_MANY_REQUESTS && error.code !== "mfa_locked")) {
    return { message: describeRateLimit(error.retryAfterSec), detail: `${error.code} · HTTP ${error.status}` };
  }
  return describeError(error);
}
