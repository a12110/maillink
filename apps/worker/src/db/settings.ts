import {
  DEFAULT_ACCENT,
  appearanceSettingsSchema,
  authSettingsSchema,
  linksSettingsSchema,
  logsSettingsSchema,
  prewarmSettingsSchema,
  securitySettingsSchema,
  siteSettingsSchema,
  turnstileSettingsInputSchema,
} from "@maillink/shared";
import { z } from "zod";
import {
  ACCESS_LOG_RETENTION_DAYS_DEFAULT,
  AUDIT_LOG_RETENTION_DAYS_DEFAULT,
  LINK_DEFAULT_POLL_INTERVAL_SEC,
  PASSWORD_MIN_LENGTH,
  PREWARM_ENABLED_DEFAULT,
  PREWARM_INTERVAL_MIN_DEFAULT,
  SESSION_ABSOLUTE_SEC,
  SESSION_IDLE_SEC,
} from "../constants";
import { nowSec } from "../clock";

// 系统设置读写：库里没有的键取代码默认值。键的类型与默认值只在 SETTING_DEFINITIONS 定义一次，
// 各字段的 schema 直接取自 packages/shared 的分组 schema（与分组 API 同一份）。
// 库里存 JSON 文本；值不符合 schema 说明数据被改坏，直接抛错而不是悄悄换成默认值。
// 分组到键的对应见 db/settings-groups.ts。

const site = siteSettingsSchema.shape;
const appearance = appearanceSettingsSchema.shape;
const auth = authSettingsSchema.shape;
const turnstile = turnstileSettingsInputSchema.shape;
const security = securitySettingsSchema.shape;
const links = linksSettingsSchema.shape;
const logs = logsSettingsSchema.shape;
const prewarm = prewarmSettingsSchema.shape;

export const SETTING_DEFINITIONS = {
  "site.name": { schema: site.name, default: "MailLink" },
  "site.logo": { schema: site.logo, default: "" },
  "site.description": { schema: site.description, default: "" },
  "site.footer": { schema: site.footer, default: "" },
  "site.login_notice": { schema: site.login_notice, default: "" },
  "site.pickup_notice": { schema: site.pickup_notice, default: "" },
  "appearance.preset": { schema: appearance.preset, default: "default" as const },
  "appearance.accent": { schema: appearance.accent, default: DEFAULT_ACCENT },
  "appearance.mode": { schema: appearance.mode, default: "system" as const },
  "appearance.radius": { schema: appearance.radius, default: "4" as const },
  // 键名沿用 M1 的 registration.enabled，分组 API 里属于 auth 组的 registration_enabled
  "registration.enabled": { schema: auth.registration_enabled, default: false },
  "auth.login_methods": { schema: auth.login_methods, default: ["password", "passkey", "oauth"] as Array<"password" | "passkey" | "oauth"> },
  // D7：OAuth 登录后是否仍要求本地 2FA（只对已启用 TOTP 的用户生效），默认不要求
  "auth.oauth_require_2fa": { schema: auth.oauth_require_2fa, default: false },
  "turnstile.enabled": { schema: turnstile.enabled, default: false },
  "turnstile.site_key": { schema: turnstile.site_key, default: "" },
  "turnstile.scopes": { schema: turnstile.scopes, default: ["login", "register", "pickup"] as Array<"login" | "register" | "pickup"> },
  /** AES-GCM 密文（见 turnstile/config.ts）；空串 = 未设置。不属于任何分组的明文字段，读取接口只回"已设置" */
  "turnstile.secret_enc": { schema: z.string(), default: "" },
  "security.admin_require_2fa": { schema: security.admin_require_2fa, default: false },
  "security.session_idle_sec": { schema: security.session_idle_sec, default: SESSION_IDLE_SEC },
  "security.session_absolute_sec": { schema: security.session_absolute_sec, default: SESSION_ABSOLUTE_SEC },
  "security.password_min_length": { schema: security.password_min_length, default: PASSWORD_MIN_LENGTH },
  "links.default_expires_in_days": { schema: links.default_expires_in_days, default: null as number | null },
  "links.default_poll_interval_sec": { schema: links.default_poll_interval_sec, default: LINK_DEFAULT_POLL_INTERVAL_SEC },
  "links.show_brand": { schema: links.show_brand, default: true },
  "logs.access_retention_days": { schema: logs.access_retention_days, default: ACCESS_LOG_RETENTION_DAYS_DEFAULT },
  "logs.audit_retention_days": { schema: logs.audit_retention_days, default: AUDIT_LOG_RETENTION_DAYS_DEFAULT },
  "prewarm.enabled": { schema: prewarm.enabled, default: PREWARM_ENABLED_DEFAULT },
  "prewarm.interval_minutes": { schema: prewarm.interval_minutes, default: PREWARM_INTERVAL_MIN_DEFAULT },
} satisfies Record<string, { schema: z.ZodType; default: unknown }>;

type Definitions = typeof SETTING_DEFINITIONS;
export type SettingKey = keyof Definitions;
export type SettingValue<K extends SettingKey> = z.output<Definitions[K]["schema"]>;

type SettingRow = { key: string; value: string };

/** 一次查询读取多个设置 */
export async function getSettings<K extends SettingKey>(
  db: D1Database,
  keys: readonly K[],
): Promise<{ [P in K]: SettingValue<P> }> {
  const placeholders = keys.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all<SettingRow>();
  const stored = new Map(results.map((row) => [row.key, row.value]));

  const entries = keys.map((key) => {
    const definition = SETTING_DEFINITIONS[key];
    const text = stored.get(key);
    if (text === undefined) return [key, definition.default] as const;
    return [key, definition.schema.parse(JSON.parse(text))] as const;
  });
  return Object.fromEntries(entries) as { [P in K]: SettingValue<P> };
}

export type SettingEntry = readonly [SettingKey, unknown];

/**
 * 在同一个 batch 里写入多个设置（upsert）。每个值先按该键的 schema 校验，不合格直接抛错，不写库。
 * updatedBy 是执行修改的管理员 id。
 */
export async function setSettings(db: D1Database, entries: readonly SettingEntry[], updatedBy: number | null): Promise<void> {
  const now = nowSec();
  const statements = entries.map(([key, value]) => {
    const parsed = SETTING_DEFINITIONS[key].schema.parse(value);
    return db
      .prepare(
        `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .bind(key, JSON.stringify(parsed), now, updatedBy);
  });
  if (statements.length > 0) await db.batch(statements);
}
