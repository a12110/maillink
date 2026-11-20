import type { Context } from "hono";
import { clientIp } from "../auth/session";
import {
  RATE_LIMITER_SETTINGS,
  RATE_LIMIT_BINDING_BY_PURPOSE,
  RATE_LIMIT_KEY_PART_MAX_LENGTH,
  RATE_LIMIT_NO_IP_PART,
} from "../constants";
import type { RateLimitPurpose, RateLimiterBindingName } from "../constants";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { HTTP_SERVICE_UNAVAILABLE, HTTP_TOO_MANY_REQUESTS } from "../http-status";

// 限流帮助函数（01 §2）。阈值在 wrangler.jsonc 的 ratelimits 里，这里只负责选 binding、组 key、调用、转成响应。
// 用途与 binding 的对应见 constants.ts 的 RATE_LIMIT_BINDING_BY_PURPOSE：取件链接用 LINK_RATE_LIMITER，其余用 RATE_LIMITER。

export const RATE_LIMITER_NOT_CONFIGURED_CODE = "rate_limiter_not_configured";
export const RATE_LIMITED_CODE = "rate_limited";

/** 请求来源 IP：取 CF-Connecting-IP；本地开发与测试没有这个头时归入共用的 `no-ip` 桶（偏严，不放行） */
export function requestIp(c: Context<AppEnv>): string {
  return clientIp(c) ?? RATE_LIMIT_NO_IP_PART;
}

/** `<用途>:<片段>[:<片段>]`；片段按长度截断，防止超长输入撑大 key */
export function rateLimitKey(purpose: RateLimitPurpose, ...parts: readonly string[]): string {
  return [purpose, ...parts.map((part) => part.slice(0, RATE_LIMIT_KEY_PART_MAX_LENGTH))].join(":");
}

/**
 * 记一次并检查限流；超限或未配置时抛 ApiError（由全局 onError 转成响应）。
 * - 该用途对应的 binding 缺失：503 `rate_limiter_not_configured`，不静默放行；
 * - 超限：429 `rate_limited`，带 `Retry-After`（binding 不返回剩余时间，取该 binding 的窗口长度作为上界）。
 * binding 自身抛错（基础设施故障）原样抛出，请求失败而不是放行。
 *
 * 取件链接（M3b-2）用法：
 *   await enforceRateLimit(c, RATE_LIMIT_PURPOSES.link, tokenHash, requestIp(c));
 * 注意：每次调用都会消耗一次配额，包括之后被其他检查拒绝的请求，这正是想要的。
 */
/** 按名字取限流 binding：逐个写出，不对 env 做计算属性访问（MAIL_DB 守卫禁止 env[k]） */
function limiterBinding(env: AppEnv["Bindings"], name: RateLimiterBindingName): RateLimit | undefined {
  switch (name) {
    case "RATE_LIMITER":
      return env.RATE_LIMITER;
    case "LINK_RATE_LIMITER":
      return env.LINK_RATE_LIMITER;
    default: {
      const unhandled: never = name;
      throw new Error(`未知的限流 binding：${String(unhandled)}`);
    }
  }
}

export async function enforceRateLimit(
  c: Context<AppEnv>,
  purpose: RateLimitPurpose,
  ...parts: readonly string[]
): Promise<void> {
  const bindingName = RATE_LIMIT_BINDING_BY_PURPOSE[purpose];
  const limiter = limiterBinding(c.env, bindingName);
  if (!limiter) {
    throw new ApiError(
      HTTP_SERVICE_UNAVAILABLE,
      RATE_LIMITER_NOT_CONFIGURED_CODE,
      `服务端未配置限流（${bindingName}），相关功能暂不可用`,
    );
  }
  const { success } = await limiter.limit({ key: rateLimitKey(purpose, ...parts) });
  if (success) return;
  // onError 里的 c.json 会带上这里设置的响应头
  c.header("Retry-After", String(RATE_LIMITER_SETTINGS[bindingName].periodSec));
  throw new ApiError(HTTP_TOO_MANY_REQUESTS, RATE_LIMITED_CODE, "请求过于频繁，请稍后再试");
}
