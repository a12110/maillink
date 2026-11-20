import {
  APP_SECRET_MIN_LENGTH,
  APP_SECRET_PLACEHOLDER_PREFIX,
  BITS_PER_BYTE,
  DEFAULT_KEY_BYTES,
} from "../constants";
import type { Bindings } from "../env";
import { utf8 } from "./crypto";

/**
 * 子密钥用途。每个用途派生出互不相同的密钥，一个用途泄露不影响其他用途。
 * 新增用途（TOTP 加密、Cookie 签名、token 加密、OAuth secret 加密）在这里加一项即可。
 */
export const KEY_PURPOSES = {
  passwordPepper: "password-pepper",
  sessionPublicId: "session-public-id",
  /** AES-GCM：users.totp_secret_enc */
  totpSecret: "totp-secret",
  /** HMAC：恢复码的库内摘要 */
  recoveryCode: "recovery-code",
  /** HMAC：签名 Cookie（pending_auth、通行密钥 challenge） */
  signedCookie: "signed-cookie",
  /** AES-GCM：加密 Cookie（TOTP 启用前的暂存密钥、OAuth 流程状态） */
  encryptedCookie: "encrypted-cookie",
  /** AES-GCM：oauth_providers.client_secret_enc */
  oauthClientSecret: "oauth-client-secret",
  /** HMAC：WebAuthn user handle（不把用户 id 直接交给认证器） */
  passkeyUserHandle: "passkey-user-handle",
} as const;
export type KeyPurpose = (typeof KEY_PURPOSES)[keyof typeof KEY_PURPOSES];

/** HKDF 的盐：固定非秘密值。APP_SECRET 本身是高熵随机串，不需要每次随机盐 */
const HKDF_SALT = utf8("maillink/hkdf-salt/v1");
const HKDF_INFO_PREFIX = "maillink/v1/";

function requireSecret(env: Pick<Bindings, "APP_SECRET">): string {
  const secret = env.APP_SECRET;
  if (typeof secret !== "string" || secret.length < APP_SECRET_MIN_LENGTH) {
    throw new Error(
      `APP_SECRET 未配置或长度不足 ${APP_SECRET_MIN_LENGTH} 个字符（本地放在 apps/worker/.dev.vars，生产用 wrangler secret）`,
    );
  }
  if (secret.startsWith(APP_SECRET_PLACEHOLDER_PREFIX)) {
    throw new Error("APP_SECRET 仍是 .dev.vars.example 里的占位值，请用 openssl rand -base64 48 生成真实值");
  }
  return secret;
}

/** 用 HKDF-SHA256 从 APP_SECRET 派生指定用途的原始密钥字节 */
export async function deriveKey(
  env: Pick<Bindings, "APP_SECRET">,
  purpose: KeyPurpose,
  lengthBytes: number = DEFAULT_KEY_BYTES,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", utf8(requireSecret(env)), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: utf8(`${HKDF_INFO_PREFIX}${purpose}`) },
    material,
    lengthBytes * BITS_PER_BYTE,
  );
  return new Uint8Array(bits);
}
