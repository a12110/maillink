import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

// 所有 /api/* 响应统一带的安全头（M7b）。挂在 index.ts 最前面，CSRF 拒绝、限流、404、onError 生成的响应也带上。
// 页面（HTML 与静态资源）由 Workers Static Assets 直出，不经过 Worker，它们的安全头由构建时生成的 _headers 提供
// （apps/web/scripts/gen-headers.mjs）。
// Cache-Control：API 响应多含个人数据（会话、用户、设置），默认 no-store（FIN-A）；
// 路由自己显式设置过的保留原值，这里只补缺失的。
export const apiSecurityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
});
