import { getSettings } from "../db/settings";
import { ApiError } from "../errors";
import { HTTP_BAD_REQUEST } from "../http-status";

/**
 * 新设置的密码（注册、改密、管理员建号与重置）要满足系统设置 security.password_min_length。
 * zod 的 newPasswordSchema 已保证硬下限与上限；这里补上管理员调高后的下限。登录不调用它，老用户照常登录。
 */
export async function assertPasswordPolicy(db: D1Database, password: string): Promise<void> {
  const { "security.password_min_length": minLength } = await getSettings(db, ["security.password_min_length"]);
  if (password.length < minLength) {
    throw new ApiError(HTTP_BAD_REQUEST, "password_too_short", `密码至少 ${minLength} 个字符`);
  }
}
