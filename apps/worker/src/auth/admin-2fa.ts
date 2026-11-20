import { getSettings } from "../db/settings";
import { findUserById } from "../db/users";
import type { AuthContext } from "./context";

/**
 * 系统要求管理员两步验证（03 §4.2，设置 security.admin_require_2fa）时，本会话是否还不满足：
 * 管理员、未启用 TOTP、且不是通行密钥登录（通行密钥登录视为已完成多因素）。
 * 这样的会话访问 /api/admin/* 得到 403 admin_2fa_required；/api/me/* 不受影响，用来去启用 2FA。
 * 启用 TOTP 后同一会话立即放行，不需要重新登录。
 */
export async function adminTwoFactorMissing(db: D1Database, auth: AuthContext): Promise<boolean> {
  if (auth.user.role !== "admin") return false;
  const { "security.admin_require_2fa": required } = await getSettings(db, ["security.admin_require_2fa"]);
  if (!required) return false;
  if (auth.session.authMethods.includes("passkey")) return false;
  const user = await findUserById(db, auth.user.id);
  return user === null || user.totp_enabled_at === null;
}
