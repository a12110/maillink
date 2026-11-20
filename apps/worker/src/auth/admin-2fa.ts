import { getSettings } from "../db/settings";
import type { AuthContext } from "./context";

/** 会话 auth_methods 里算作"已完成多因素"的方式：登录第二步的 TOTP / 恢复码，或通行密钥登录 */
export const MULTI_FACTOR_SESSION_METHODS: readonly string[] = ["totp", "recovery", "passkey"];

/** 会话在登录（或之后启用 TOTP）时是否完成过多因素 */
export function sessionHasMultiFactor(authMethods: readonly string[]): boolean {
  return authMethods.some((method) => MULTI_FACTOR_SESSION_METHODS.includes(method));
}

/** 启用 TOTP 成功后当前会话的 auth_methods：补记 totp */
export function withTotpFactor(authMethods: readonly string[]): string[] {
  return authMethods.includes("totp") ? [...authMethods] : [...authMethods, "totp"];
}

/** 关闭 TOTP 后当前会话的 auth_methods：去掉 totp 与 recovery（通行密钥登录的 passkey 保留） */
export function withoutTotpFactors(authMethods: readonly string[]): string[] {
  return authMethods.filter((method) => method !== "totp" && method !== "recovery");
}

/**
 * 系统要求管理员两步验证（03 §4.2，设置 security.admin_require_2fa）时，本会话是否还不满足：
 * 只看会话自己的 auth_methods，必须含 totp / recovery / passkey。账号"已启用 TOTP"不够——
 * 走 OAuth 单因素登录的会话同样被挡（开启该设置时，已启用 TOTP 的管理员走 OAuth 会进入 pending_auth，见 oauth-link.ts）。
 * 这样的会话访问 /api/admin/* 得到 403 admin_2fa_required；/api/me/* 不受影响，用来去启用 2FA。
 * 在账号安全页启用 TOTP 时当前会话会补记 totp（启用要求当场输对一次验证码），所以启用后同一会话立即放行；
 * 关闭 TOTP 时当前会话去掉 totp / recovery。
 */
export async function adminTwoFactorMissing(db: D1Database, auth: AuthContext): Promise<boolean> {
  if (auth.user.role !== "admin") return false;
  const { "security.admin_require_2fa": required } = await getSettings(db, ["security.admin_require_2fa"]);
  return required && !sessionHasMultiFactor(auth.session.authMethods);
}
