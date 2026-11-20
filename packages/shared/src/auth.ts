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

/** 登录方式标识，对应 public config 的 login_methods 与系统设置 auth.login_methods */
export const loginMethodSchema = z.enum(["password", "passkey", "oauth"]);
export type LoginMethod = z.infer<typeof loginMethodSchema>;

// ---- 公开 ----

/** 登录页上展示的 OAuth 提供方：只有 slug、名称、图标 */
export const publicOAuthProviderSchema = z.object({
  slug: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
});
export type PublicOAuthProvider = z.infer<typeof publicOAuthProviderSchema>;

/** MAIL_DB 兼容状态：ok 正常；no_icloud 表健康但缺 to_address；unhealthy 缺表或缺必需列；probe_failed 探测查询本身失败 */
export const mailDbCompatStatusSchema = z.enum(["ok", "no_icloud", "unhealthy", "probe_failed"]);
export type MailDbCompatStatus = z.infer<typeof mailDbCompatStatusSchema>;

/** 探测查询失败的错误码：binding_missing 没有绑定 MAIL_DB，query_failed 查询抛错（详情只写 Worker 日志） */
export const MAIL_DB_PROBE_ERROR_CODES = ["binding_missing", "query_failed"] as const;

/** 邮件库兼容信息，只含状态、db_version 与缺失的必需列，不含其他库结构 */
export const mailDbCompatSchema = z.object({
  status: mailDbCompatStatusSchema,
  db_version: z.string().nullable(),
  /** unhealthy 时为缺失的必需列（表不存在时为全部必需列）；其余状态为空数组 */
  missing_required: z.array(z.string()),
  /** 仅 probe_failed 时有 */
  error_code: z.enum(MAIL_DB_PROBE_ERROR_CODES).optional(),
});
export type MailDbCompat = z.infer<typeof mailDbCompatSchema>;

/**
 * GET /api/setup/status（公开）。判别联合：
 * - needs_setup=true：带 mail_db（初始化页据此提示邮件库兼容情况）；
 * - needs_setup=false：不带 mail_db，服务端也不探测 MAIL_DB，避免公开接口泄露库结构。
 */
export const setupStatusSchema = z.discriminatedUnion("needs_setup", [
  z.object({ needs_setup: z.literal(true), mail_db: mailDbCompatSchema }),
  z.object({ needs_setup: z.literal(false) }),
]);
export type SetupStatus = z.infer<typeof setupStatusSchema>;

export const setupRequestSchema = z.object({
  username: usernameSchema,
  password: newPasswordSchema,
  setup_token: z.string().min(1, "请输入初始化令牌"),
});
export type SetupRequest = z.infer<typeof setupRequestSchema>;

// ---- 认证 ----

/** Cloudflare 文档给出的 Turnstile token 长度上限 */
export const TURNSTILE_TOKEN_MAX_LENGTH = 2048;
export const turnstileTokenSchema = z.string().min(1).max(TURNSTILE_TOKEN_MAX_LENGTH);

export const loginRequestSchema = z.object({
  username: z.string().min(1, "请输入用户名").max(USERNAME_MAX_LENGTH),
  password: existingPasswordSchema,
  /** 系统开启登录人机验证时必填 */
  turnstile_token: turnstileTokenSchema.optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** 二次验证可用的方式 */
export const mfaMethodSchema = z.enum(["totp", "recovery"]);
export type MfaMethod = z.infer<typeof mfaMethodSchema>;

/**
 * 密码登录结果：`ok` 已发会话；`mfa_required` 未发会话，改发 5 分钟有效的 `pending_auth` Cookie，
 * 前端接着调用 `/api/auth/mfa/totp` 或 `/api/auth/mfa/recovery`。
 */
export const loginResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok") }),
  z.object({
    status: z.literal("mfa_required"),
    methods: z.array(mfaMethodSchema),
    /** pending_auth 的过期时间（Unix 秒） */
    expires_at: z.number().int(),
  }),
]);
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
  /**
   * 服务端总会带出。true = 系统要求管理员启用两步验证，而本会话是管理员、未启用 TOTP 且不是通行密钥登录：
   * 访问 /api/admin/* 会得到 403 admin_2fa_required，前端应引导去账号安全页启用。
   * 声明为可选只是为了不破坏已有的前端测试夹具。
   */
  admin_2fa_required: z.boolean().optional(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
