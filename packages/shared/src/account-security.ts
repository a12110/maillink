import { z } from "zod";
import { existingPasswordSchema, publicOAuthProviderSchema } from "./auth";
import {
  PASSKEY_NAME_MAX_LENGTH,
  RECOVERY_CODE_INPUT_MAX_LENGTH,
  TOTP_DIGITS,
  WEBAUTHN_FIELD_MAX_LENGTH,
} from "./auth-limits";

// 账号安全（M5）：两步验证、恢复码、通行密钥、OAuth 绑定、会话批量注销、管理端清除凭据。

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${TOTP_DIGITS}}$`), `请输入 ${TOTP_DIGITS} 位数字验证码`);

export const recoveryCodeInputSchema = z.string().trim().min(1, "请输入恢复码").max(RECOVERY_CODE_INPUT_MAX_LENGTH);

// ---- 登录第二步 ----

export const mfaTotpRequestSchema = z.object({ code: totpCodeSchema });
export type MfaTotpRequest = z.infer<typeof mfaTotpRequestSchema>;

export const mfaRecoveryRequestSchema = z.object({ code: recoveryCodeInputSchema });
export type MfaRecoveryRequest = z.infer<typeof mfaRecoveryRequestSchema>;

// ---- 两步验证管理 ----

export const totpSetupResponseSchema = z.object({
  /** base32 密钥，供无法扫码时手动输入 */
  secret: z.string(),
  /** 生成二维码用的 otpauth:// URI */
  otpauth_uri: z.string(),
  /** 暂存密钥的过期时间（Unix 秒），过期后需重新 setup */
  expires_at: z.number().int(),
});
export type TotpSetupResponse = z.infer<typeof totpSetupResponseSchema>;

/**
 * code 是刚扫码的新密钥算出的验证码；password 是当前密码（有密码的账号必填，
 * 没有密码的账号可省略，此时要求会话是最近登录的，见 worker auth/reauth.ts）
 */
export const totpEnableRequestSchema = z.object({ code: totpCodeSchema, password: existingPasswordSchema.optional() });
export type TotpEnableRequest = z.infer<typeof totpEnableRequestSchema>;

/** 启用 2FA 与重新生成恢复码都返回明文恢复码，只展示这一次 */
export const recoveryCodesResponseSchema = z.object({ recovery_codes: z.array(z.string()) });
export type RecoveryCodesResponse = z.infer<typeof recoveryCodesResponseSchema>;

/** 敏感操作的再次确认：当前密码或当前 TOTP，二选一 */
export const reauthRequestSchema = z
  .object({ password: existingPasswordSchema.optional(), code: totpCodeSchema.optional() })
  .refine((value) => (value.password === undefined) !== (value.code === undefined), "请提供当前密码或验证码其中之一");
export type ReauthRequest = z.infer<typeof reauthRequestSchema>;

// ---- 通行密钥 ----

const base64UrlSchema = z
  .string()
  .max(WEBAUTHN_FIELD_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_-]*$/, "必须是 base64url");
const credentialIdSchema = base64UrlSchema.min(1);
const authenticatorAttachmentSchema = z.enum(["platform", "cross-platform"]).optional();
const TRANSPORT_MAX_LENGTH = 32;
const TRANSPORTS_MAX_COUNT = 8;
const transportsSchema = z.array(z.string().max(TRANSPORT_MAX_LENGTH)).max(TRANSPORTS_MAX_COUNT);

/** navigator.credentials.create() 结果的 JSON 形式（@simplewebauthn/browser 的 RegistrationResponseJSON） */
export const registrationResponseJsonSchema = z.object({
  id: credentialIdSchema,
  rawId: credentialIdSchema,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64UrlSchema,
    attestationObject: base64UrlSchema,
    transports: transportsSchema.optional(),
  }),
  authenticatorAttachment: authenticatorAttachmentSchema,
});

/** navigator.credentials.get() 结果的 JSON 形式（AuthenticationResponseJSON） */
export const authenticationResponseJsonSchema = z.object({
  id: credentialIdSchema,
  rawId: credentialIdSchema,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64UrlSchema,
    authenticatorData: base64UrlSchema,
    signature: base64UrlSchema,
    userHandle: base64UrlSchema.optional(),
  }),
  authenticatorAttachment: authenticatorAttachmentSchema,
});

/** 注册通行密钥前的再确认：当前密码或当前 TOTP（至多一个；没有密码的账号可都省略，要求最近登录） */
export const passkeyOptionsRequestSchema = z
  .object({ password: existingPasswordSchema.optional(), code: totpCodeSchema.optional() })
  .refine((value) => value.password === undefined || value.code === undefined, "密码与验证码只需提供一个");
export type PasskeyOptionsRequest = z.infer<typeof passkeyOptionsRequestSchema>;

export const passkeyNameSchema = z.string().trim().min(1, "请输入名称").max(PASSKEY_NAME_MAX_LENGTH);

export const passkeyRegisterVerifyRequestSchema = z.object({
  response: registrationResponseJsonSchema,
  name: passkeyNameSchema.optional(),
});
export type PasskeyRegisterVerifyRequest = z.infer<typeof passkeyRegisterVerifyRequestSchema>;

export const passkeyLoginVerifyRequestSchema = z.object({ response: authenticationResponseJsonSchema });
export type PasskeyLoginVerifyRequest = z.infer<typeof passkeyLoginVerifyRequestSchema>;

export const passkeyRenameRequestSchema = z.object({ name: passkeyNameSchema });
export type PasskeyRenameRequest = z.infer<typeof passkeyRenameRequestSchema>;

export const myPasskeySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  transports: z.array(z.string()),
  created_at: z.number().int(),
  last_used_at: z.number().int().nullable(),
});
export type MyPasskey = z.infer<typeof myPasskeySchema>;
export const myPasskeyListSchema = z.object({ items: z.array(myPasskeySchema) });

// ---- OAuth 绑定 ----

export const myIdentitySchema = z.object({
  id: z.number().int(),
  provider: publicOAuthProviderSchema,
  email: z.string().nullable(),
  display_name: z.string().nullable(),
  created_at: z.number().int(),
  last_login_at: z.number().int().nullable(),
});
export type MyIdentity = z.infer<typeof myIdentitySchema>;
export const myIdentityListSchema = z.object({ items: z.array(myIdentitySchema) });

/**
 * 发起 OAuth 绑定（POST /api/auth/oauth/:slug/link）前的再确认，口径同注册通行密钥：
 * 当前密码或当前 TOTP 至多一个；没有密码的账号可都省略，此时要求会话是最近登录的（worker auth/reauth.ts）。
 */
export const oauthLinkStartRequestSchema = passkeyOptionsRequestSchema;
export type OAuthLinkStartRequest = PasskeyOptionsRequest;

/** 提供方授权地址：前端拿到后整页跳转（location.assign），state 已绑定到当前会话 */
export const oauthLinkStartResponseSchema = z.object({ authorize_url: z.string().url() });
export type OAuthLinkStartResponse = z.infer<typeof oauthLinkStartResponseSchema>;

/**
 * OAuth 回调结束后 302 回前端时带的结果码（查询参数 `oauth`）。
 * login 模式回 `/login`，link 模式回 `/account`。令牌从不出现在 URL 里。
 */
export const oauthResultCodeSchema = z.enum([
  "ok",
  "linked",
  "mfa_required",
  "already_linked",
  "identity_taken",
  "not_linked",
  "account_disabled",
  "link_requires_login",
  "provider_unavailable",
  "state_invalid",
  "denied",
  "exchange_failed",
  "token_invalid",
  "profile_invalid",
  "signup_failed",
]);
export type OAuthResultCode = z.infer<typeof oauthResultCodeSchema>;

// ---- 会话 ----

export const revokeSessionsQuerySchema = z.object({ scope: z.literal("others") });

export const sessionsRevokedResponseSchema = z.object({ status: z.literal("ok"), revoked: z.number().int() });
export type SessionsRevokedResponse = z.infer<typeof sessionsRevokedResponseSchema>;

// ---- 删除凭据后的结果（用户自己与管理端共用） ----

export const credentialRemovalResponseSchema = z.object({
  status: z.literal("ok"),
  removed: z.number().int(),
  sessions_revoked: z.number().int(),
  /** 该用户已没有任何可用的登录方式（密码、通行密钥、已启用提供方的绑定），界面应提示管理员为其设置密码 */
  no_login_method: z.boolean(),
});
export type CredentialRemovalResponse = z.infer<typeof credentialRemovalResponseSchema>;
