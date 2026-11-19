import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from "@maillink/shared";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { HTTP_FORBIDDEN } from "../http-status";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF 防护（03 §3）：SameSite=Lax 之外，对写操作校验两件事——
 * 1. `Origin` 必须等于 PUBLIC_ORIGIN（缺失也拒绝：浏览器对跨站和同站写请求都会带 Origin）；
 * 2. 必须带自定义请求头 `X-MailLink-Csrf: 1`（跨站表单提交无法设置自定义头）。
 */
export const csrfProtection = createMiddleware<AppEnv>(async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const expectedOrigin = new URL(c.env.PUBLIC_ORIGIN).origin;
  if (c.req.header("Origin") !== expectedOrigin) {
    throw new ApiError(HTTP_FORBIDDEN, "csrf_origin_mismatch", "请求来源不被允许");
  }
  if (c.req.header(CSRF_HEADER_NAME) !== CSRF_HEADER_VALUE) {
    throw new ApiError(HTTP_FORBIDDEN, "csrf_header_missing", `缺少请求头 ${CSRF_HEADER_NAME}`);
  }
  return next();
});
