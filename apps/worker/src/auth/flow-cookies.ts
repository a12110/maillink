import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { OAUTH_STATE_SEC, PASSKEY_CHALLENGE_SEC, PENDING_MFA_SEC, TOTP_SETUP_SEC } from "../constants";
import type { AppEnv } from "../env";

// 短时流程 Cookie。全部 HttpOnly + Secure，Path 收窄到只会读取它的接口前缀。
// 只在同源 fetch 里使用的用 SameSite=Strict；OAuth 回调是从 IdP 跳回来的顶级 GET 导航，必须用 Lax。

export type FlowCookieSpec = {
  name: string;
  path: string;
  sameSite: "Strict" | "Lax";
  maxAge: number;
};

export const FLOW_COOKIES = {
  /** 签名：密码已通过、等待二次验证 */
  pendingAuth: { name: "pending_auth", path: "/api/auth/mfa", sameSite: "Strict", maxAge: PENDING_MFA_SEC },
  /** 加密：启用 2FA 前暂存的 TOTP 密钥 */
  totpSetup: { name: "totp_setup", path: "/api/me/totp", sameSite: "Strict", maxAge: TOTP_SETUP_SEC },
  /** 签名：通行密钥注册 challenge */
  passkeyRegistration: {
    name: "passkey_reg",
    path: "/api/me/passkeys",
    sameSite: "Strict",
    maxAge: PASSKEY_CHALLENGE_SEC,
  },
  /** 签名：通行密钥登录 challenge */
  passkeyLogin: { name: "passkey_auth", path: "/api/auth/passkey", sameSite: "Strict", maxAge: PASSKEY_CHALLENGE_SEC },
  /** 加密：OAuth state / nonce / PKCE code_verifier / 发起模式 */
  oauthFlow: { name: "oauth_flow", path: "/api/auth/oauth", sameSite: "Lax", maxAge: OAUTH_STATE_SEC },
} as const satisfies Record<string, FlowCookieSpec>;

export function setFlowCookie(c: Context<AppEnv>, spec: FlowCookieSpec, value: string): void {
  setCookie(c, spec.name, value, {
    httpOnly: true,
    secure: true,
    sameSite: spec.sameSite,
    path: spec.path,
    maxAge: spec.maxAge,
  });
}

export function readFlowCookie(c: Context<AppEnv>, spec: FlowCookieSpec): string | undefined {
  return getCookie(c, spec.name);
}

export function clearFlowCookie(c: Context<AppEnv>, spec: FlowCookieSpec): void {
  deleteCookie(c, spec.name, { httpOnly: true, secure: true, sameSite: spec.sameSite, path: spec.path });
}
