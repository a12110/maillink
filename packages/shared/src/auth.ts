import { z } from "zod";
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from "./limits";

export const usernameSchema = z
  .string()
  .min(USERNAME_MIN_LENGTH, `用户名至少 ${USERNAME_MIN_LENGTH} 个字符`)
  .max(USERNAME_MAX_LENGTH, `用户名最多 ${USERNAME_MAX_LENGTH} 个字符`)
  .regex(USERNAME_PATTERN, "用户名只能包含字母、数字、点、下划线和连字符，且以字母或数字开头");

/** 新设置的密码（创建、改密、重置）才校验最小长度 */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 个字符`)
  .max(PASSWORD_MAX_LENGTH, `密码最多 ${PASSWORD_MAX_LENGTH} 个字符`);

/** 校验已有密码（登录、改密时的旧密码）：不套最小长度，避免规则收紧后老用户无法登录 */
export const existingPasswordSchema = z.string().min(1, "请输入密码").max(PASSWORD_MAX_LENGTH);

export const displayNameSchema = z.string().max(DISPLAY_NAME_MAX_LENGTH);
export const emailSchema = z.email().max(EMAIL_MAX_LENGTH);

export const userRoleSchema = z.enum(["admin", "user"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userStatusSchema = z.enum(["active", "disabled"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

/** 登录方式标识，对应 public config 的 login_methods */
export const loginMethodSchema = z.enum(["password"]);
export type LoginMethod = z.infer<typeof loginMethodSchema>;

// ---- 公开 ----

export const publicConfigSchema = z.object({
  site_name: z.string(),
  registration_enabled: z.boolean(),
  login_methods: z.array(loginMethodSchema),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;

export const setupStatusSchema = z.object({ needs_setup: z.boolean() });
export type SetupStatus = z.infer<typeof setupStatusSchema>;

export const setupRequestSchema = z.object({
  username: usernameSchema,
  password: newPasswordSchema,
  setup_token: z.string().min(1, "请输入初始化令牌"),
});
export type SetupRequest = z.infer<typeof setupRequestSchema>;

// ---- 认证 ----

export const loginRequestSchema = z.object({
  username: z.string().min(1, "请输入用户名").max(USERNAME_MAX_LENGTH),
  password: existingPasswordSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** M5 加入 TOTP 后这里会扩成 `ok | mfa_required` 的联合 */
export const loginResponseSchema = z.object({ status: z.literal("ok") });
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const sessionUserSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  role: userRoleSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  /** 本次会话的登录方式，如 ["password"] */
  auth_methods: z.array(z.string()),
  /** 绝对过期时间（Unix 秒） */
  expires_at: z.number().int(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
