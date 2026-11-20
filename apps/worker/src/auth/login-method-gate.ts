import type { LoginMethod } from "@maillink/shared";
import { getSettings } from "../db/settings";
import { ApiError } from "../errors";
import { HTTP_FORBIDDEN } from "../http-status";

/** 设置 auth.login_methods 未开放该方式时拒绝（通行密钥、OAuth 登录入口在开始处调用） */
export async function loginMethodEnabled(db: D1Database, method: LoginMethod): Promise<boolean> {
  const { "auth.login_methods": methods } = await getSettings(db, ["auth.login_methods"]);
  return methods.includes(method);
}

export async function requireLoginMethod(db: D1Database, method: LoginMethod): Promise<void> {
  if (!(await loginMethodEnabled(db, method))) {
    throw new ApiError(HTTP_FORBIDDEN, "login_method_disabled", "该登录方式未启用");
  }
}
