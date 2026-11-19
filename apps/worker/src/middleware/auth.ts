import { createMiddleware } from "hono/factory";
import { authenticate } from "../auth/session";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { HTTP_FORBIDDEN } from "../http-status";

/** 需要登录；通过后 `c.var.auth` 可用 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  c.set("auth", await authenticate(c));
  await next();
});

/** 需要管理员。未登录 401，已登录但不是管理员 403 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const auth = await authenticate(c);
  if (auth.user.role !== "admin") {
    throw new ApiError(HTTP_FORBIDDEN, "forbidden", "需要管理员权限");
  }
  c.set("auth", auth);
  await next();
});
