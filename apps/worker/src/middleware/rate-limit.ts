import type { MiddlewareHandler } from "hono";
import { RATE_LIMIT_PURPOSES } from "../constants";
import type { RateLimitPurpose } from "../constants";
import type { AppEnv } from "../env";
import { enforceRateLimit, requestIp } from "../ratelimit";

/** 按来源 IP 限流 */
export function rateLimitByIp(purpose: RateLimitPurpose): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await enforceRateLimit(c, purpose, requestIp(c));
    await next();
  };
}

/**
 * 从请求体里取登录用户名（小写）。读的是 `raw.clone()`，原请求体不受影响，后面的 handler 照常读取。
 * 请求体不是 JSON 或没有字符串 username 时返回 null：这类请求会在 handler 里被校验成 400，
 * 且仍受 IP 限流约束。
 */
async function peekUsername(request: Request): Promise<string | null> {
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || !("username" in body)) return null;
  const { username } = body;
  return typeof username === "string" ? username.trim().toLowerCase() : null;
}

/** 登录：先按 IP，再按用户名（用户名存在与否都计数，不泄露账号是否存在） */
export const rateLimitLogin: MiddlewareHandler<AppEnv> = async (c, next) => {
  await enforceRateLimit(c, RATE_LIMIT_PURPOSES.loginIp, requestIp(c));
  const username = await peekUsername(c.req.raw);
  if (username !== null) await enforceRateLimit(c, RATE_LIMIT_PURPOSES.loginUser, username);
  await next();
};
