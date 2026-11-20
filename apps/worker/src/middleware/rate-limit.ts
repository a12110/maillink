import type { MiddlewareHandler } from "hono";
import { LOGIN_BODY_MAX_BYTES, RATE_LIMIT_PURPOSES } from "../constants";
import type { RateLimitPurpose } from "../constants";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { HTTP_PAYLOAD_TOO_LARGE } from "../http-status";
import { enforceRateLimit, requestIp } from "../ratelimit";

/** 按来源 IP 限流 */
export function rateLimitByIp(purpose: RateLimitPurpose): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await enforceRateLimit(c, purpose, requestIp(c));
    await next();
  };
}

function bodyTooLarge(): ApiError {
  return new ApiError(HTTP_PAYLOAD_TOO_LARGE, "payload_too_large", `请求体超过 ${LOGIN_BODY_MAX_BYTES} 字节`);
}

/**
 * 读取（克隆的）请求体文本，最多 LOGIN_BODY_MAX_BYTES，超出抛 413。
 * 先看 Content-Length 直接拒绝；没有该头（分块传输）时按读到的字节累计，超限即停止读取。
 */
async function readCappedBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > LOGIN_BODY_MAX_BYTES) throw bodyTooLarge();

  const clone = request.clone();
  if (clone.body === null) return null;
  const reader = clone.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LOGIN_BODY_MAX_BYTES) {
      await reader.cancel();
      throw bodyTooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * 从请求体里取登录用户名（小写）。读的是 `raw.clone()`，原请求体不受影响，后面的 handler 照常读取。
 * 请求体不是 JSON 或没有字符串 username 时返回 null：这类请求会在 handler 里被校验成 400，
 * 且仍受 IP 限流约束。请求体过大抛 413。
 */
async function peekUsername(request: Request): Promise<string | null> {
  const text = await readCappedBody(request);
  if (text === null) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
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
