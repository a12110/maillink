import { z } from "zod";
import {
  existingPasswordSchema,
  newPasswordSchema,
  userRoleSchema,
  userStatusSchema,
  usernameSchema,
} from "./auth";
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  LIST_PAGE_SIZE_MAX,
  SEARCH_KEYWORD_MAX_LENGTH,
} from "./limits";
import { listResponseSchema } from "./http";
import { myIdentitySchema, myPasskeySchema } from "./account-security";

/** 空串视为"清空"；邮箱统一小写（库里只存 email_lc） */
const optionalDisplayNameSchema = z
  .string()
  .trim()
  .max(DISPLAY_NAME_MAX_LENGTH)
  .transform((value) => value || null)
  .nullable();

const optionalEmailSchema = z
  .string()
  .trim()
  .max(EMAIL_MAX_LENGTH)
  .transform((value) => value.toLowerCase() || null)
  .pipe(z.email().nullable())
  .nullable();

function hasAtLeastOneField(value: object): boolean {
  return Object.values(value).some((field) => field !== undefined);
}
const AT_LEAST_ONE_FIELD = "至少需要修改一个字段";

// ---- 当前用户 ----

export const meResponseSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  role: userRoleSchema,
  has_password: z.boolean(),
  /** 是否已启用两步验证 */
  totp_enabled: z.boolean(),
  /** 未使用的恢复码个数；未启用 2FA 时为 0 */
  recovery_codes_remaining: z.number().int(),
  created_at: z.number().int(),
  last_login_at: z.number().int().nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const updateMeRequestSchema = z
  .object({ display_name: optionalDisplayNameSchema.optional(), email: optionalEmailSchema.optional() })
  .refine(hasAtLeastOneField, AT_LEAST_ONE_FIELD);
export type UpdateMeRequest = z.input<typeof updateMeRequestSchema>;

export const changePasswordRequestSchema = z.object({
  current_password: existingPasswordSchema,
  new_password: newPasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** 会话对外的 id 是 HMAC 派生的短 id，不是库里的 id_hash，见 worker/src/auth/session-public-id.ts */
export const mySessionSchema = z.object({
  id: z.string(),
  current: z.boolean(),
  auth_methods: z.array(z.string()),
  created_at: z.number().int(),
  last_seen_at: z.number().int(),
  expires_at: z.number().int(),
  ip: z.string().nullable(),
  user_agent: z.string().nullable(),
});
export type MySession = z.infer<typeof mySessionSchema>;
export const mySessionListSchema = z.object({ items: z.array(mySessionSchema) });

// ---- 管理端用户 ----

export const adminUserSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  role: userRoleSchema,
  status: userStatusSchema,
  created_at: z.number().int(),
  last_login_at: z.number().int().nullable(),
  /** 登录方式标记，见 03 §6 */
  login_methods: z.object({
    password: z.boolean(),
    totp: z.boolean(),
    passkey_count: z.number().int(),
    oauth_providers: z.array(z.string()),
  }),
  mailbox_grant_count: z.number().int(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

/** GET /api/admin/users/:id：在列表字段之外带上通行密钥与 OAuth 绑定明细，供单个清除时选择 */
export const adminUserDetailSchema = adminUserSchema.extend({
  passkeys: z.array(myPasskeySchema),
  identities: z.array(myIdentitySchema),
});
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;

export const adminUserListSchema = listResponseSchema(adminUserSchema);
export type AdminUserList = z.infer<typeof adminUserListSchema>;

export const adminUserListQuerySchema = z.object({
  q: z.string().trim().max(SEARCH_KEYWORD_MAX_LENGTH).optional(),
  role: userRoleSchema.optional(),
  status: userStatusSchema.optional(),
  cursor: z.string().regex(/^\d+$/, "cursor 无效").optional(),
  limit: z.coerce.number().int().min(1).max(LIST_PAGE_SIZE_MAX).optional(),
});
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

export const adminUserCreateSchema = z.object({
  username: usernameSchema,
  password: newPasswordSchema,
  display_name: optionalDisplayNameSchema.optional(),
  email: optionalEmailSchema.optional(),
  role: userRoleSchema.default("user"),
  status: userStatusSchema.default("active"),
});
export type AdminUserCreate = z.input<typeof adminUserCreateSchema>;

export const adminUserPatchSchema = z
  .object({
    username: usernameSchema.optional(),
    display_name: optionalDisplayNameSchema.optional(),
    email: optionalEmailSchema.optional(),
    role: userRoleSchema.optional(),
    status: userStatusSchema.optional(),
  })
  .refine(hasAtLeastOneField, AT_LEAST_ONE_FIELD);
export type AdminUserPatch = z.input<typeof adminUserPatchSchema>;

export const adminPasswordResetSchema = z.object({ password: newPasswordSchema });
export type AdminPasswordReset = z.infer<typeof adminPasswordResetSchema>;

export const adminSessionsRevokedSchema = z.object({
  status: z.literal("ok"),
  revoked: z.number().int(),
});
