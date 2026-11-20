import type { Context } from "hono";
import { clientIp } from "../auth/session";
import {
  RATE_LIMIT_KEY_PART_MAX_LENGTH,
  RATE_LIMIT_NO_IP_PART,
  RATE_LIMIT_PERIOD_SEC,
} from "../constants";
import type { RateLimitPurpose } from "../constants";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { HTTP_SERVICE_UNAVAILABLE } from "../http-status";

// 限流帮助函数（01 §2）。阈值在 wrangler.jsonc 的 ratelimits 里，这里只负责组 key、调用、转成响应。

// 429 暂不在 http-status.ts 里：该文件不归 M7a，合并时由主 agent 移过去
const HTTP_TOO_MANY_REQUESTS = 429;

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
 * - binding 缺失：503 `rate_limiter_not_configured`，不静默放行；
 * - 超限：429 `rate_limited`，带 `Retry-After`（binding 不返回剩余时间，取窗口长度作为上界）。
 * binding 自身抛错（基础设施故障）原样抛出，请求失败而不是放行。
 *
 * 取件链接（M3b-2）用法：
 *   await enforceRateLimit(c, RATE_LIMIT_PURPOSES.link, tokenHash, requestIp(c));
 * 注意：每次调用都会消耗一次配额，包括之后被其他检查拒绝的请求，这正是想要的。
 */
export async function enforceRateLimit(
  c: Context<AppEnv>,
  purpose: RateLimitPurpose,
  ...parts: readonly string[]
): Promise<void> {
  const limiter = c.env.RATE_LIMITER;
  if (!limiter) {
    throw new ApiError(
      HTTP_SERVICE_UNAVAILABLE,
      RATE_LIMITER_NOT_CONFIGURED_CODE,
      "服务端未配置限流（RATE_LIMITER），相关功能暂不可用",
    );
  }
  const { success } = await limiter.limit({ key: rateLimitKey(purpose, ...parts) });
  if (success) return;
  // onError 里的 c.json 会带上这里设置的响应头
  c.header("Retry-After", String(RATE_LIMIT_PERIOD_SEC));
  throw new ApiError(HTTP_TOO_MANY_REQUESTS, RATE_LIMITED_CODE, "请求过于频繁，请稍后再试");
}
