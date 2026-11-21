import { z } from "zod";
import { loginMethodSchema, publicOAuthProviderSchema } from "./auth";
import { healthResponseSchema } from "./health";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./limits";

// 系统设置分组（03 §7）。每组一个 schema：GET 返回它，PUT 整组替换。
// 单个设置项的 schema 就是这里各字段的 schema，worker 的 SETTING_DEFINITIONS 直接引用，不另写一份。

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

export const SITE_NAME_MAX_LENGTH = 64;
export const SITE_DESCRIPTION_MAX_LENGTH = 280;
export const SITE_FOOTER_MAX_LENGTH = 200;
export const SITE_NOTICE_MAX_LENGTH = 500;
/** Logo 可以是 data URI，上限按字符数计 */
export const SITE_LOGO_MAX_LENGTH = 65_536;

export const TURNSTILE_SITE_KEY_MAX_LENGTH = 128;
export const TURNSTILE_SECRET_MAX_LENGTH = 256;

export const SESSION_DURATION_MIN_SEC = SECONDS_PER_HOUR;
export const SESSION_DURATION_MAX_SEC = 365 * SECONDS_PER_DAY;

/** 取件链接默认值；LINK_POLL_INTERVAL_MIN_SEC 必须与 worker constants 的 LINK_POLL_MIN_SEC 一致（有测试守着） */
export const LINK_DEFAULT_EXPIRES_DAYS_MAX = 3650;
export const LINK_POLL_INTERVAL_MIN_SEC = 10;
export const LINK_POLL_INTERVAL_MAX_SEC = 3600;

export const LOG_RETENTION_DAYS_MAX = 3650;

// ---- 站点信息（公开） ----

const DATA_IMAGE_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/i;

/** https 地址：主机名只含字母数字点连字符（无用户名密码），可带端口、路径、查询，不含空白与控制字符 */
const HTTPS_URL_PATTERN = /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?(?:[/?#][^\s]*)?$/;

/** 只允许 https 地址或 data:image/*;base64；空串表示没有 Logo */
function isAllowedLogo(value: string): boolean {
  return value === "" || DATA_IMAGE_PATTERN.test(value) || HTTPS_URL_PATTERN.test(value);
}

export const siteLogoSchema = z
  .string()
  .max(SITE_LOGO_MAX_LENGTH, `Logo 最长 ${SITE_LOGO_MAX_LENGTH} 个字符`)
  .refine(isAllowedLogo, "Logo 只能是 https 地址或 data:image/…;base64 数据");

export const siteSettingsSchema = z.strictObject({
  name: z.string().trim().min(1, "请输入站点名称").max(SITE_NAME_MAX_LENGTH),
  logo: siteLogoSchema,
  description: z.string().trim().max(SITE_DESCRIPTION_MAX_LENGTH),
  footer: z.string().trim().max(SITE_FOOTER_MAX_LENGTH),
  login_notice: z.string().trim().max(SITE_NOTICE_MAX_LENGTH),
  pickup_notice: z.string().trim().max(SITE_NOTICE_MAX_LENGTH),
});
export type SiteSettings = z.infer<typeof siteSettingsSchema>;

// ---- 外观（公开） ----

/** 主题预设：目前前端只有一套变量值，预设名先占位，新增预设时在这里追加 */
export const THEME_PRESETS = ["default"] as const;
export const themePresetSchema = z.enum(THEME_PRESETS);
export const themeModeSchema = z.enum(["light", "dark", "system"]);
export const themeRadiusSchema = z.enum(["0", "4", "8"]);
export const accentColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "强调色必须是 #rrggbb 格式")
  .transform((value) => value.toLowerCase());

export const appearanceSettingsSchema = z.strictObject({
  preset: themePresetSchema,
  accent: accentColorSchema,
  mode: themeModeSchema,
  radius: themeRadiusSchema,
});
export type AppearanceSettings = z.infer<typeof appearanceSettingsSchema>;

// ---- 注册与登录 ----

export const authSettingsSchema = z.strictObject({
  registration_enabled: z.boolean(),
  login_methods: z
    .array(loginMethodSchema)
    .min(1, "至少保留一种登录方式")
    .refine((methods) => new Set(methods).size === methods.length, "登录方式不能重复"),
  oauth_require_2fa: z.boolean(),
});
export type AuthSettings = z.infer<typeof authSettingsSchema>;

// ---- 人机验证 ----

export const turnstileScopeSchema = z.enum(["login", "register", "pickup"]);
export type TurnstileScope = z.infer<typeof turnstileScopeSchema>;

const turnstileScopesSchema = z
  .array(turnstileScopeSchema)
  .refine((scopes) => new Set(scopes).size === scopes.length, "作用范围不能重复");
const turnstileSiteKeySchema = z.string().trim().max(TURNSTILE_SITE_KEY_MAX_LENGTH);

/** PUT：secret 不带表示不修改；只能设置，不能清除 */
export const turnstileSettingsInputSchema = z.strictObject({
  enabled: z.boolean(),
  site_key: turnstileSiteKeySchema,
  secret: z.string().trim().min(1, "secret 不能为空").max(TURNSTILE_SECRET_MAX_LENGTH).optional(),
  scopes: turnstileScopesSchema,
});
export type TurnstileSettingsInput = z.infer<typeof turnstileSettingsInputSchema>;

/** GET：secret 永远不回，只说明是否已设置 */
export const turnstileSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  site_key: turnstileSiteKeySchema,
  secret_set: z.boolean(),
  scopes: turnstileScopesSchema,
});
export type TurnstileSettings = z.infer<typeof turnstileSettingsSchema>;

// ---- 安全 ----

const sessionDurationSchema = z.number().int().min(SESSION_DURATION_MIN_SEC).max(SESSION_DURATION_MAX_SEC);

/** 新密码长度下限：不能低于代码里的硬下限，也不能超过上限 */
export const passwordMinLengthSchema = z.number().int().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const securitySettingsSchema = z
  .strictObject({
    admin_require_2fa: z.boolean(),
    session_idle_sec: sessionDurationSchema,
    session_absolute_sec: sessionDurationSchema,
    password_min_length: passwordMinLengthSchema,
  })
  .refine((value) => value.session_idle_sec <= value.session_absolute_sec, {
    message: "空闲时长不能超过绝对时长",
    path: ["session_idle_sec"],
  });
export type SecuritySettings = z.infer<typeof securitySettingsSchema>;

// ---- 取件链接默认值 ----

export const linksSettingsSchema = z.strictObject({
  /** 新建链接的默认有效天数；null 表示默认不过期 */
  default_expires_in_days: z.number().int().min(1).max(LINK_DEFAULT_EXPIRES_DAYS_MAX).nullable(),
  default_poll_interval_sec: z.number().int().min(LINK_POLL_INTERVAL_MIN_SEC).max(LINK_POLL_INTERVAL_MAX_SEC),
  /** 取件页是否显示站点品牌（名称与 Logo） */
  show_brand: z.boolean(),
});
export type LinksSettings = z.infer<typeof linksSettingsSchema>;

// ---- 日志 ----

const retentionDaysSchema = z.number().int().min(1).max(LOG_RETENTION_DAYS_MAX);
export const logsSettingsSchema = z.strictObject({
  access_retention_days: retentionDaysSchema,
  audit_retention_days: retentionDaysSchema,
});
export type LogsSettings = z.infer<typeof logsSettingsSchema>;

// ---- 后台预热 ----

/** 预热间隔的可选档位（分钟），必须是 worker 里 cron 触发周期 PREWARM_CRON_TICK_MIN 的整数倍（有测试守着） */
export const PREWARM_INTERVAL_OPTIONS_MIN = [30, 60] as const;
export type PrewarmIntervalMin = (typeof PREWARM_INTERVAL_OPTIONS_MIN)[number];

export const prewarmSettingsSchema = z.strictObject({
  /** 关闭时不在后台预解析，新邮件只在被访问时现场解析 */
  enabled: z.boolean(),
  interval_minutes: z.literal(PREWARM_INTERVAL_OPTIONS_MIN),
});
export type PrewarmSettings = z.infer<typeof prewarmSettingsSchema>;

// ---- 系统状态（只读） ----

/** 健康检查结果再加上 db_version 与 mail_index 行数；不健康时也是 200，由 ok 字段表达 */
export const systemSettingsSchema = healthResponseSchema.extend({
  db_version: z.string().nullable(),
  mail_index_rows: z.number().int(),
});
export type SystemSettings = z.infer<typeof systemSettingsSchema>;

// ---- 分组 ----

export const WRITABLE_SETTING_GROUPS = ["site", "appearance", "auth", "turnstile", "security", "links", "logs", "prewarm"] as const;
export const writableSettingGroupSchema = z.enum(WRITABLE_SETTING_GROUPS);
export type WritableSettingGroup = z.infer<typeof writableSettingGroupSchema>;

export const settingGroupSchema = z.enum([...WRITABLE_SETTING_GROUPS, "system"]);
export type SettingGroup = z.infer<typeof settingGroupSchema>;

/** GET 响应类型：分组名 → 响应体 */
export type SettingsByGroup = {
  site: SiteSettings;
  appearance: AppearanceSettings;
  auth: AuthSettings;
  turnstile: TurnstileSettings;
  security: SecuritySettings;
  links: LinksSettings;
  logs: LogsSettings;
  prewarm: PrewarmSettings;
  system: SystemSettings;
};

// ---- 公开配置（GET /api/public/config） ----

/**
 * 免登录可读：带"公开"标记的设置（03 §7）。取件页公告 pickup_notice 在这里；
 * "取件页是否显示站点品牌"（links.show_brand）不公开，由取件接口 GET /api/s/:token 带出。
 */
export const publicConfigSchema = z.object({
  site_name: z.string(),
  /** 空串表示没有 Logo；否则是 https 地址或 data:image URI */
  site_logo: z.string(),
  site_description: z.string(),
  site_footer: z.string(),
  login_notice: z.string(),
  pickup_notice: z.string(),
  appearance: appearanceSettingsSchema,
  registration_enabled: z.boolean(),
  login_methods: z.array(loginMethodSchema),
  /** 已启用的提供方，按 sort 排序；login_methods 不含 oauth 时为空 */
  oauth_providers: z.array(publicOAuthProviderSchema),
  turnstile: z.object({
    enabled: z.boolean(),
    site_key: z.string(),
    scopes: z.array(turnstileScopeSchema),
  }),
  /** 密码最小长度（security.password_min_length），注册页与改密码表单提示用；服务端照常校验 */
  password_min_length: z.number().int(),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;
