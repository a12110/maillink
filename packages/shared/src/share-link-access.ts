import { z } from "zod";
import { normalizeCidrText } from "./ip-cidr";

// 取件链接的访问约束（02 §6 C 层），存于 share_links.access。
// 三种形态：接口入参（明文口令 password）、库里存储（password_hash）、管理端展示（has_password，不含哈希）。

export const LINK_ACCESS_LIMITS = {
  /** 与 worker constants 的 LINK_POLL_MIN_SEC 一致（有测试保证） */
  pollIntervalMinSec: 10,
  pollIntervalMaxSec: 3600,
  pollIntervalDefaultSec: 10,
  maxDevicesMax: 100,
  deliveriesTotalMax: 100_000,
  deliveriesPerDayMax: 10_000,
  ipAllowMax: 50,
  countryAllowMax: 50,
  cidrMaxLength: 64,
  passwordMinLength: 4,
  passwordMaxLength: 128,
} as const;

export const LINK_REVEAL_MODES = ["auto", "click"] as const;
export type LinkRevealMode = (typeof LINK_REVEAL_MODES)[number];

/** ISO 3166-1 alpha-2 正式代码（249 个） */
const ISO_COUNTRY_CODES = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
    "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
    "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

export function isIsoCountryCode(code: string): boolean {
  return ISO_COUNTRY_CODES.has(code);
}

const cidrSchema = z
  .string()
  .trim()
  .min(1)
  .max(LINK_ACCESS_LIMITS.cidrMaxLength)
  .refine((value) => normalizeCidrText(value) !== null, "不是合法的 IPv4 / IPv6 地址或 CIDR（IPv4 映射地址的前缀须 ≥ 96）")
  .transform((value) => normalizeCidrText(value) as string);

const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isIsoCountryCode, "不是 ISO 3166-1 alpha-2 国家代码");

const positiveUpTo = (max: number) => z.number().int().min(1).max(max);

/** 口令以外的约束（三种形态共用） */
const commonFields = {
  /** 人机验证；M6 接入 Turnstile 之前保存时一律拒绝 */
  turnstile: z.boolean().default(false),
  /** 设备数上限；1 = 首个访问者绑定；不设 = 不限 */
  max_devices: positiveUpTo(LINK_ACCESS_LIMITS.maxDevicesMax).optional(),
  reveal: z.enum(LINK_REVEAL_MODES).default("auto"),
  /** 按不同邮件计的取码次数上限；设了任一上限必须 reveal=click */
  max_deliveries_total: positiveUpTo(LINK_ACCESS_LIMITS.deliveriesTotalMax).optional(),
  /** 滚动 24 小时内的取码次数上限 */
  max_deliveries_per_day: positiveUpTo(LINK_ACCESS_LIMITS.deliveriesPerDayMax).optional(),
  /** 允许的来源 IP（CIDR）；空 = 不限 */
  ip_allow: z.array(cidrSchema).max(LINK_ACCESS_LIMITS.ipAllowMax).default([]),
  /** 允许的国家（request.cf.country）；空 = 不限 */
  country_allow: z.array(countrySchema).max(LINK_ACCESS_LIMITS.countryAllowMax).default([]),
  poll_interval_sec: z
    .number()
    .int()
    .min(LINK_ACCESS_LIMITS.pollIntervalMinSec)
    .max(LINK_ACCESS_LIMITS.pollIntervalMaxSec)
    .default(LINK_ACCESS_LIMITS.pollIntervalDefaultSec),
};

/** 首尾空白去掉后再检查长度（保存与"开始取码"用同一个 schema，两边口径一致） */
export const linkPasswordSchema = z
  .string()
  .trim()
  .min(LINK_ACCESS_LIMITS.passwordMinLength)
  .max(LINK_ACCESS_LIMITS.passwordMaxLength);

/**
 * 接口入参。`password`：不给 = 保持原口令（创建时即无口令）；null = 清除；字符串 = 设为新口令（服务端哈希）。
 */
export const linkAccessInputSchema = z.strictObject({
  password: linkPasswordSchema.nullable().optional(),
  ...commonFields,
});
export type LinkAccessInput = z.input<typeof linkAccessInputSchema>;
export type LinkAccessInputParsed = z.output<typeof linkAccessInputSchema>;

/** 库里存储的形态 */
export const linkAccessStoredSchema = z.strictObject({
  password_hash: z.string().min(1).optional(),
  ...commonFields,
});
export type LinkAccessStored = z.output<typeof linkAccessStoredSchema>;

/** 管理端展示：不含哈希 */
export const linkAccessViewSchema = z.strictObject({
  has_password: z.boolean(),
  ...commonFields,
});
export type LinkAccessView = z.output<typeof linkAccessViewSchema>;

export const LINK_ACCESS_ISSUES = {
  revealMustBeClick: "reveal_must_be_click",
} as const;

/** 跨字段约束：设了取码次数上限就必须 click（02 §6：auto 模式下后台轮询会白白消耗次数） */
export function linkAccessIssue(
  access: Pick<LinkAccessStored, "reveal" | "max_deliveries_total" | "max_deliveries_per_day">,
): (typeof LINK_ACCESS_ISSUES)[keyof typeof LINK_ACCESS_ISSUES] | null {
  const limited = access.max_deliveries_total !== undefined || access.max_deliveries_per_day !== undefined;
  return limited && access.reveal !== "click" ? LINK_ACCESS_ISSUES.revealMustBeClick : null;
}
