import { createMiddleware } from "hono/factory";
import { adminTwoFactorMissing } from "../auth/admin-2fa";
import { authenticate } from "../auth/session";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { HTTP_FORBIDDEN } from "../http-status";

/** 需要登录；通过后 `c.var.auth` 可用 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  c.set("auth", await authenticate(c));
  await next();
});

/**
 * 需要管理员。未登录 401，已登录但不是管理员 403 forbidden；
 * 系统要求管理员两步验证而该会话还没有时 403 admin_2fa_required（见 auth/admin-2fa.ts）。
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const auth = await authenticate(c);
  if (auth.user.role !== "admin") {
    throw new ApiError(HTTP_FORBIDDEN, "forbidden", "需要管理员权限");
  }
  if (await adminTwoFactorMissing(c.env.APP_DB, auth)) {
    throw new ApiError(HTTP_FORBIDDEN, "admin_2fa_required", "系统要求管理员启用两步验证，请先在账号安全页启用");
  }
  c.set("auth", auth);
  await next();
});
