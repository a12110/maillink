import {
  appearanceSettingsSchema,
  authSettingsSchema,
  linksSettingsSchema,
  logsSettingsSchema,
  prewarmSettingsSchema,
  securitySettingsSchema,
  SESSION_DURATION_MAX_SEC,
  SESSION_DURATION_MIN_SEC,
  siteSettingsSchema,
  turnstileSettingsInputSchema,
} from "@maillink/shared";
import type {
  AppearanceSettings,
  AuthSettings,
  LinksSettings,
  LogsSettings,
  PrewarmSettings,
  SecuritySettings,
  SettingsByGroup,
  SiteSettings,
  TurnstileScope,
  WritableSettingGroup,
} from "@maillink/shared";
import type { z } from "zod";
import type { SettingsInputByGroup } from "../../api/endpoints";
import { fieldErrorsFromZod } from "../../lib/forms";

// 设置表单的草稿 ↔ 接口数据。草稿是表单里正在编辑的值（数字用字符串，便于输入到一半），
// toInput 把草稿转成 PUT 请求体并用 shared 的同一份 schema 校验，toDraft 把 GET 响应转回草稿；两者往返一致。

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;

/** 秒数的中文说法：整天用“天”，整小时用“小时”，其余用“秒” */
export function formatDuration(seconds: number): string {
  if (seconds % SECONDS_PER_DAY === 0) return `${seconds / SECONDS_PER_DAY} 天`;
  if (seconds % SECONDS_PER_HOUR === 0) return `${seconds / SECONDS_PER_HOUR} 小时`;
  return `${seconds} 秒`;
}

/** 会话时长的范围提示，取自 shared（与服务端同一份常量） */
export const SESSION_DURATION_MIN_TEXT = formatDuration(SESSION_DURATION_MIN_SEC);
export const SESSION_DURATION_MAX_TEXT = formatDuration(SESSION_DURATION_MAX_SEC);

/** 会话时长超出 shared 允许的范围时的中文原因；范围内返回 null */
function sessionRangeError(seconds: number): string | null {
  if (seconds < SESSION_DURATION_MIN_SEC) return `不能短于 ${SESSION_DURATION_MIN_TEXT}`;
  if (seconds > SESSION_DURATION_MAX_SEC) return `不能长于 ${SESSION_DURATION_MAX_TEXT}`;
  return null;
}

export type TurnstileDraft = { enabled: boolean; site_key: string; secret: string; scopes: TurnstileScope[] };
export type SecurityDraft = {
  admin_require_2fa: boolean;
  /** 小时 */
  session_idle_hours: string;
  /** 天 */
  session_absolute_days: string;
  password_min_length: string;
};
export type LinksDraft = { default_expires_in_days: string; default_poll_interval_sec: string; show_brand: boolean };
export type LogsDraft = { access_retention_days: string; audit_retention_days: string };

export type DraftByGroup = {
  site: SiteSettings;
  appearance: AppearanceSettings;
  auth: AuthSettings;
  turnstile: TurnstileDraft;
  security: SecurityDraft;
  links: LinksDraft;
  logs: LogsDraft;
  prewarm: PrewarmSettings;
};

export type ParseResult<I> =
  | { ok: true; value: I }
  | { ok: false; fields: Record<string, string>; form: string | null };

export type GroupSpec<G extends WritableSettingGroup> = {
  toDraft: (data: SettingsByGroup[G]) => DraftByGroup[G];
  toInput: (draft: DraftByGroup[G]) => ParseResult<SettingsInputByGroup[G]>;
};

const NOT_A_NUMBER = "请输入数字";

/** 空串或非数字返回 null */
export function toNumber(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** 用 schema 校验；schema 的字段名与草稿字段名不同时用 rename 对回去 */
function validate<S extends z.ZodType<Record<string, unknown>>>(
  schema: S,
  raw: unknown,
  keys: readonly string[],
  rename: Record<string, string> = {},
): ParseResult<z.output<S>> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const { fields, form } = fieldErrorsFromZod(parsed.error, keys);
  const renamed = Object.fromEntries(Object.entries(fields).map(([key, message]) => [rename[key] ?? key, message ?? ""]));
  return { ok: false, fields: renamed, form };
}

/** 先把草稿里的数字字段转成数；有不是数字的就直接报错，不交给 schema 产生“Invalid input”这类文案 */
function numbers<K extends string>(draft: Record<K, string>, names: readonly K[]): { values: Record<K, number | null>; errors: Record<string, string> } {
  const values = {} as Record<K, number | null>;
  const errors: Record<string, string> = {};
  for (const name of names) {
    values[name] = toNumber(draft[name]);
    if (values[name] === null) errors[name] = NOT_A_NUMBER;
  }
  return { values, errors };
}

const failed = (fields: Record<string, string>): ParseResult<never> => ({ ok: false, fields, form: null });

const site: GroupSpec<"site"> = {
  toDraft: (data) => ({ ...data }),
  toInput: (draft) => validate(siteSettingsSchema, draft, Object.keys(draft)),
};

const appearance: GroupSpec<"appearance"> = {
  toDraft: (data) => ({ ...data }),
  toInput: (draft) => validate(appearanceSettingsSchema, draft, Object.keys(draft)),
};

const auth: GroupSpec<"auth"> = {
  toDraft: (data) => ({ ...data, login_methods: [...data.login_methods] }),
  toInput: (draft) => validate(authSettingsSchema, draft, Object.keys(draft)),
};

const turnstile: GroupSpec<"turnstile"> = {
  toDraft: (data) => ({ enabled: data.enabled, site_key: data.site_key, secret: "", scopes: [...data.scopes] }),
  // secret 留空表示不改：请求体里不带这个字段（后端只能设置、不能清除）
  toInput: ({ secret, ...rest }) =>
    validate(turnstileSettingsInputSchema, secret.trim() === "" ? rest : { ...rest, secret }, ["enabled", "site_key", "secret", "scopes"]),
};

const security: GroupSpec<"security"> = {
  toDraft: (data) => ({
    admin_require_2fa: data.admin_require_2fa,
    session_idle_hours: String(data.session_idle_sec / SECONDS_PER_HOUR),
    session_absolute_days: String(data.session_absolute_sec / SECONDS_PER_DAY),
    password_min_length: String(data.password_min_length),
  }),
  toInput: (draft) => {
    const { values, errors } = numbers(draft, ["session_idle_hours", "session_absolute_days", "password_min_length"]);
    if (Object.keys(errors).length > 0) return failed(errors);
    const raw: SecuritySettings = {
      admin_require_2fa: draft.admin_require_2fa,
      session_idle_sec: Math.round((values.session_idle_hours ?? 0) * SECONDS_PER_HOUR),
      session_absolute_sec: Math.round((values.session_absolute_days ?? 0) * SECONDS_PER_DAY),
      password_min_length: values.password_min_length ?? 0,
    };
    const rangeErrors: Record<string, string> = {};
    const idleRange = sessionRangeError(raw.session_idle_sec);
    const absoluteRange = sessionRangeError(raw.session_absolute_sec);
    if (idleRange !== null) rangeErrors["session_idle_hours"] = idleRange;
    if (absoluteRange !== null) rangeErrors["session_absolute_days"] = absoluteRange;
    const result = validate(securitySettingsSchema, raw, Object.keys(raw), {
      session_idle_sec: "session_idle_hours",
      session_absolute_sec: "session_absolute_days",
    });
    if (Object.keys(rangeErrors).length === 0) return result;
    // 范围错误用中文原文，与 schema 的其他字段错误（如密码最小长度）合并一起返回
    return result.ok ? failed(rangeErrors) : { ...result, fields: { ...result.fields, ...rangeErrors } };
  },
};

const links: GroupSpec<"links"> = {
  toDraft: (data) => ({
    default_expires_in_days: data.default_expires_in_days === null ? "" : String(data.default_expires_in_days),
    default_poll_interval_sec: String(data.default_poll_interval_sec),
    show_brand: data.show_brand,
  }),
  toInput: (draft) => {
    // 有效天数留空 = 默认不过期（null）
    const expires = toNumber(draft.default_expires_in_days);
    if (draft.default_expires_in_days.trim() !== "" && expires === null) return failed({ default_expires_in_days: NOT_A_NUMBER });
    const { values, errors } = numbers(draft, ["default_poll_interval_sec"]);
    if (Object.keys(errors).length > 0) return failed(errors);
    const raw: LinksSettings = {
      default_expires_in_days: expires,
      default_poll_interval_sec: values.default_poll_interval_sec ?? 0,
      show_brand: draft.show_brand,
    };
    return validate(linksSettingsSchema, raw, Object.keys(raw));
  },
};

const logs: GroupSpec<"logs"> = {
  toDraft: (data) => ({
    access_retention_days: String(data.access_retention_days),
    audit_retention_days: String(data.audit_retention_days),
  }),
  toInput: (draft) => {
    const { values, errors } = numbers(draft, ["access_retention_days", "audit_retention_days"]);
    if (Object.keys(errors).length > 0) return failed(errors);
    const raw: LogsSettings = {
      access_retention_days: values.access_retention_days ?? 0,
      audit_retention_days: values.audit_retention_days ?? 0,
    };
    return validate(logsSettingsSchema, raw, Object.keys(raw));
  },
};

const prewarm: GroupSpec<"prewarm"> = {
  toDraft: (data) => ({ ...data }),
  toInput: (draft) => validate(prewarmSettingsSchema, draft, Object.keys(draft)),
};

export const GROUP_SPECS = { site, appearance, auth, turnstile, security, links, logs, prewarm } as const satisfies {
  [G in WritableSettingGroup]: GroupSpec<G>;
};

/** 按分组名取规格：映射表按分组逐项 satisfies 过了，但 TS 无法在泛型 G 上把联合收窄回 GroupSpec<G>，在这一处断言 */
export function specFor<G extends WritableSettingGroup>(group: G): GroupSpec<G> {
  return GROUP_SPECS[group] as unknown as GroupSpec<G>;
}

/** 草稿里与已保存值不同的字段个数（“未保存 N 处”） */
export function countChanged(draft: object, baseline: object): number {
  const keys = new Set([...Object.keys(draft), ...Object.keys(baseline)]);
  let changed = 0;
  for (const key of keys) {
    const a = (draft as Record<string, unknown>)[key];
    const b = (baseline as Record<string, unknown>)[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) changed += 1;
  }
  return changed;
}
