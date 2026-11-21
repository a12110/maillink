import type { SettingsByGroup, WritableSettingGroup } from "@maillink/shared";
import { getSettings, setSettings } from "./settings";
import type { SettingEntry, SettingKey } from "./settings";

// 分组 API 的字段名到 settings 键的对应（03 §7）。分组里的字段名是对外的，键名是库里的。
// turnstile 的 secret 不在这里：它加密存储，由 turnstile/config.ts 单独处理。

type FieldMap = Readonly<Record<string, SettingKey>>;

export const GROUP_FIELDS = {
  site: {
    name: "site.name",
    logo: "site.logo",
    description: "site.description",
    footer: "site.footer",
    login_notice: "site.login_notice",
    pickup_notice: "site.pickup_notice",
  },
  appearance: {
    preset: "appearance.preset",
    accent: "appearance.accent",
    mode: "appearance.mode",
    radius: "appearance.radius",
  },
  auth: {
    registration_enabled: "registration.enabled",
    login_methods: "auth.login_methods",
    oauth_require_2fa: "auth.oauth_require_2fa",
  },
  turnstile: {
    enabled: "turnstile.enabled",
    site_key: "turnstile.site_key",
    scopes: "turnstile.scopes",
  },
  security: {
    admin_require_2fa: "security.admin_require_2fa",
    session_idle_sec: "security.session_idle_sec",
    session_absolute_sec: "security.session_absolute_sec",
    password_min_length: "security.password_min_length",
  },
  links: {
    default_expires_in_days: "links.default_expires_in_days",
    default_poll_interval_sec: "links.default_poll_interval_sec",
    show_brand: "links.show_brand",
  },
  logs: {
    access_retention_days: "logs.access_retention_days",
    audit_retention_days: "logs.audit_retention_days",
  },
  prewarm: {
    enabled: "prewarm.enabled",
    interval_minutes: "prewarm.interval_minutes",
  },
} as const satisfies Record<WritableSettingGroup, FieldMap>;

/** 读出一个分组的全部字段（库里没有的取默认值）；turnstile 组不含 secret_set，调用方补上 */
export async function readGroupFields<G extends Exclude<WritableSettingGroup, "turnstile">>(
  db: D1Database,
  group: G,
): Promise<SettingsByGroup[G]>;
export async function readGroupFields(db: D1Database, group: WritableSettingGroup): Promise<Record<string, unknown>>;
export async function readGroupFields(db: D1Database, group: WritableSettingGroup): Promise<Record<string, unknown>> {
  const fields: FieldMap = GROUP_FIELDS[group];
  const values: Record<string, unknown> = await getSettings(db, Object.values(fields));
  return Object.fromEntries(Object.entries(fields).map(([field, key]) => [field, values[key]]));
}

/** 把一个分组的字段换算成待写入的键值；values 里缺的字段不写 */
export function groupEntries(group: WritableSettingGroup, values: Record<string, unknown>): SettingEntry[] {
  const fields: FieldMap = GROUP_FIELDS[group];
  return Object.entries(fields)
    .filter(([field]) => field in values)
    .map(([field, key]) => [key, values[field]] as const);
}

export async function writeGroupFields(
  db: D1Database,
  group: WritableSettingGroup,
  values: Record<string, unknown>,
  updatedBy: number | null,
  extra: readonly SettingEntry[] = [],
): Promise<void> {
  await setSettings(db, [...groupEntries(group, values), ...extra], updatedBy);
}
