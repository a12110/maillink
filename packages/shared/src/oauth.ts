import { z } from "zod";
import {
  OAUTH_CLIENT_ID_MAX_LENGTH,
  OAUTH_CLIENT_SECRET_MAX_LENGTH,
  OAUTH_ICON_MAX_LENGTH,
  OAUTH_NAME_MAX_LENGTH,
  OAUTH_SCOPES_MAX_LENGTH,
  OAUTH_SLUG_MAX_LENGTH,
  OAUTH_SLUG_PATTERN,
  OAUTH_URL_MAX_LENGTH,
} from "./auth-limits";

// 管理端 OAuth 提供方（03 §4.4、§7；04 设置/oauth-providers）。

export const oauthProviderKindSchema = z.enum(["oidc", "oauth2"]);
export type OAuthProviderKind = z.infer<typeof oauthProviderKindSchema>;

/** 只接受 https 地址；更严格的主机检查（拒绝 IP 字面量与内网主机名）在服务端做 */
export const httpsUrlSchema = z
  .string()
  .trim()
  .max(OAUTH_URL_MAX_LENGTH)
  .pipe(z.url({ protocol: /^https$/, error: "必须是 https 地址" }));

const CLAIM_PATH_MAX_LENGTH = 128;
/** 点路径，如 `sub`、`email`、`profile.email` */
export const claimPathSchema = z
  .string()
  .trim()
  .max(CLAIM_PATH_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_:-]+(\.[A-Za-z0-9_:-]+)*$/, "必须是点路径，如 sub 或 profile.email");

export const claimMapSchema = z.object({
  subject: claimPathSchema,
  email: claimPathSchema.nullable().default(null),
  email_verified: claimPathSchema.nullable().default(null),
  name: claimPathSchema.nullable().default(null),
});
export type ClaimMap = z.infer<typeof claimMapSchema>;

export const DEFAULT_CLAIM_MAP: ClaimMap = {
  subject: "sub",
  email: "email",
  email_verified: "email_verified",
  name: "name",
};

export const DEFAULT_OIDC_SCOPES = "openid profile email";

/** 图标：内置图标名（小写字母数字与连字符）或 https 图片地址 */
export const oauthIconSchema = z
  .string()
  .trim()
  .max(OAUTH_ICON_MAX_LENGTH)
  .refine((value) => /^[a-z0-9-]{1,32}$/.test(value) || value.startsWith("https://"), "图标必须是内置图标名或 https 地址");

const SORT_LIMIT = 1_000_000;

const providerFields = {
  slug: z.string().trim().min(1).max(OAUTH_SLUG_MAX_LENGTH).regex(OAUTH_SLUG_PATTERN, "只能包含小写字母、数字与连字符"),
  name: z.string().trim().min(1).max(OAUTH_NAME_MAX_LENGTH),
  kind: oauthProviderKindSchema,
  enabled: z.boolean().default(true),
  issuer: httpsUrlSchema.nullable().default(null),
  authorization_endpoint: httpsUrlSchema.nullable().default(null),
  token_endpoint: httpsUrlSchema.nullable().default(null),
  userinfo_endpoint: httpsUrlSchema.nullable().default(null),
  jwks_uri: httpsUrlSchema.nullable().default(null),
  client_id: z.string().trim().min(1).max(OAUTH_CLIENT_ID_MAX_LENGTH),
  /** OIDC 缺省为 openid profile email；oauth2 必填 */
  scopes: z.string().trim().min(1).max(OAUTH_SCOPES_MAX_LENGTH).nullable().default(null),
  claim_map: claimMapSchema.default(DEFAULT_CLAIM_MAP),
  allow_signup: z.boolean().default(false),
  auto_link_verified_email: z.boolean().default(false),
  icon: oauthIconSchema.nullable().default(null),
  sort: z.number().int().min(-SORT_LIMIT).max(SORT_LIMIT).default(0),
};

const clientSecretSchema = z.string().min(1).max(OAUTH_CLIENT_SECRET_MAX_LENGTH);

/** 新建：client_secret 必填 */
export const oauthProviderCreateSchema = z.object({ ...providerFields, client_secret: clientSecretSchema });
export type OAuthProviderCreate = z.input<typeof oauthProviderCreateSchema>;

/** 整体替换（PUT）：client_secret 省略表示保留原值 */
export const oauthProviderUpdateSchema = z.object({ ...providerFields, client_secret: clientSecretSchema.optional() });
export type OAuthProviderUpdate = z.input<typeof oauthProviderUpdateSchema>;

export const adminOAuthProviderSchema = z.object({
  id: z.number().int(),
  slug: z.string(),
  name: z.string(),
  kind: oauthProviderKindSchema,
  enabled: z.boolean(),
  issuer: z.string().nullable(),
  authorization_endpoint: z.string().nullable(),
  token_endpoint: z.string().nullable(),
  userinfo_endpoint: z.string().nullable(),
  jwks_uri: z.string().nullable(),
  client_id: z.string(),
  /** client_secret 从不回显，只告诉界面是否已设置 */
  client_secret_set: z.boolean(),
  scopes: z.string(),
  claim_map: claimMapSchema,
  allow_signup: z.boolean(),
  auto_link_verified_email: z.boolean(),
  icon: z.string().nullable(),
  sort: z.number().int(),
  /** 需要填到 IdP 后台的回调地址：`${PUBLIC_ORIGIN}/api/auth/oauth/<slug>/callback` */
  callback_url: z.string(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export type AdminOAuthProvider = z.infer<typeof adminOAuthProviderSchema>;
export const adminOAuthProviderListSchema = z.object({ items: z.array(adminOAuthProviderSchema) });

/** 删除或停用提供方后，已没有任何登录方式的用户 id（界面提示为其设置密码） */
export const oauthProviderChangeResponseSchema = z.object({
  provider: adminOAuthProviderSchema.nullable(),
  users_without_login_method: z.array(z.number().int()),
});
export type OAuthProviderChangeResponse = z.infer<typeof oauthProviderChangeResponseSchema>;

export const oauthDiscoverRequestSchema = z.object({ issuer: httpsUrlSchema });
export type OAuthDiscoverRequest = z.infer<typeof oauthDiscoverRequestSchema>;

export const oauthDiscoverResponseSchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  userinfo_endpoint: z.string().nullable(),
  jwks_uri: z.string(),
  scopes_supported: z.array(z.string()).nullable(),
});
export type OAuthDiscoverResponse = z.infer<typeof oauthDiscoverResponseSchema>;
