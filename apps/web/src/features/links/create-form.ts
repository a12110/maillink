import { LINK_ACCESS_LIMITS, SHARE_LINK_LIMITS, shareLinkCreateSchema } from "@maillink/shared";
import type { ShareLinkCreate } from "@maillink/shared";
import { MS_PER_SECOND } from "../../constants";
import { unitSeconds } from "./labels";
import type { ExtendUnit } from "./labels";
import type { PickedMailbox } from "./MailboxPicker";

// 创建表单：草稿 → 请求体（纯函数）。设了取码次数上限就自动切到点击取码（02 §6）；最终再过一遍 shared 的 shareLinkCreateSchema，
// 服务端会校验的限制这里用同一个 schema 提前给出，错误按字段归位。

export type ExpiryKind = "default" | "never" | "days" | "after_first";
export type CreateMode = "per_mailbox" | "combined";

export type CreateDraft = {
  mailboxes: PickedMailbox[];
  mode: CreateMode;
  ruleGroupId: number | null;
  name: string;
  orderRef: string;
  publicTitle: string;
  publicNote: string;
  expiry: ExpiryKind;
  expiryDays: string;
  afterFirstAmount: string;
  afterFirstUnit: ExtendUnit;
  password: string;
  maxDevices: string;
  reveal: "auto" | "click";
  maxTotal: string;
  maxPerDay: string;
  ipAllow: string;
  countryAllow: string;
  pollInterval: string;
  turnstile: boolean;
};

export const EMPTY_DRAFT: CreateDraft = {
  mailboxes: [],
  mode: "per_mailbox",
  ruleGroupId: null,
  name: "",
  orderRef: "",
  publicTitle: "",
  publicNote: "",
  expiry: "default",
  expiryDays: "30",
  afterFirstAmount: "3",
  afterFirstUnit: "day",
  password: "",
  maxDevices: "",
  reveal: "auto",
  maxTotal: "",
  maxPerDay: "",
  ipAllow: "",
  countryAllow: "",
  pollInterval: "",
  turnstile: false,
};

export type CreateField =
  | "mailboxes"
  | "ruleGroupId"
  | "name"
  | "orderRef"
  | "publicTitle"
  | "publicNote"
  | "expiry"
  | "password"
  | "maxDevices"
  | "maxTotal"
  | "maxPerDay"
  | "ipAllow"
  | "countryAllow"
  | "pollInterval";
export type FieldErrors = Partial<Record<CreateField, string>>;

/** 设了任一取码次数上限 */
export function isLimited(draft: Pick<CreateDraft, "maxTotal" | "maxPerDay">): boolean {
  return draft.maxTotal.trim() !== "" || draft.maxPerDay.trim() !== "";
}

/** 设了次数上限时取码方式一律是点击取码（自动模式下后台轮询会白白消耗次数） */
export function effectiveReveal(draft: Pick<CreateDraft, "reveal" | "maxTotal" | "maxPerDay">): "auto" | "click" {
  return isLimited(draft) ? "click" : draft.reveal;
}

const TOKENS = /[\s,;，；]+/u;
const splitList = (text: string): string[] => text.split(TOKENS).filter((part) => part !== "");

function positiveInt(text: string, label: string, max: number): { value: number | undefined; error?: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { value: undefined };
  if (!/^\d+$/u.test(trimmed) || Number(trimmed) < 1) return { value: undefined, error: `${label}需要是正整数` };
  if (Number(trimmed) > max) return { value: undefined, error: `${label}最大 ${max}` };
  return { value: Number(trimmed) };
}

type NumberField = { field: CreateField; label: string; text: string; max: number };

function numericFields(draft: CreateDraft): NumberField[] {
  return [
    { field: "maxDevices", label: "设备数", text: draft.maxDevices, max: LINK_ACCESS_LIMITS.maxDevicesMax },
    { field: "maxTotal", label: "总取码次数", text: draft.maxTotal, max: LINK_ACCESS_LIMITS.deliveriesTotalMax },
    { field: "maxPerDay", label: "每日取码次数", text: draft.maxPerDay, max: LINK_ACCESS_LIMITS.deliveriesPerDayMax },
    { field: "pollInterval", label: "轮询间隔（秒）", text: draft.pollInterval, max: LINK_ACCESS_LIMITS.pollIntervalMaxSec },
  ];
}

type ExpiryFields = Pick<ShareLinkCreate, "expires_at" | "expire_after_first_access_sec">;

function daysExpiry(draft: CreateDraft, now: number, errors: FieldErrors): ExpiryFields {
  const days = positiveInt(draft.expiryDays, "天数", SHARE_LINK_LIMITS.durationMaxSec / unitSeconds("day"));
  if (days.error || days.value === undefined) errors.expiry = days.error ?? "请填写有效天数";
  return { expires_at: now + (days.value ?? 0) * unitSeconds("day") };
}

function afterFirstExpiry(draft: CreateDraft, errors: FieldErrors): ExpiryFields {
  const amount = positiveInt(draft.afterFirstAmount, "时长", SHARE_LINK_LIMITS.durationMaxSec);
  if (amount.error || amount.value === undefined) errors.expiry = amount.error ?? "请填写有效时长";
  // 只按“首次取码后”失效：不叠加系统默认的绝对过期
  return { expires_at: null, expire_after_first_access_sec: (amount.value ?? 0) * unitSeconds(draft.afterFirstUnit) };
}

const EXPIRY_BUILDERS: Record<ExpiryKind, (draft: CreateDraft, now: number, errors: FieldErrors) => ExpiryFields> = {
  default: () => ({}),
  never: () => ({ expires_at: null }),
  days: daysExpiry,
  after_first: (draft, _now, errors) => afterFirstExpiry(draft, errors),
};

const BLANK_TO_UNDEFINED = (text: string): string | undefined => (text.trim() === "" ? undefined : text.trim());

/** schema 的错误路径 → 表单字段 */
const PATH_FIELD: Record<string, CreateField> = {
  mailbox_ids: "mailboxes",
  rule_group_id: "ruleGroupId",
  name: "name",
  order_ref: "orderRef",
  public_title: "publicTitle",
  public_note: "publicNote",
  expires_at: "expiry",
  expire_after_first_access_sec: "expiry",
  password: "password",
  max_devices: "maxDevices",
  max_deliveries_total: "maxTotal",
  max_deliveries_per_day: "maxPerDay",
  ip_allow: "ipAllow",
  country_allow: "countryAllow",
  poll_interval_sec: "pollInterval",
};

function collectNumbers(draft: CreateDraft, errors: FieldErrors): Partial<Record<CreateField, number>> {
  const numbers: Partial<Record<CreateField, number>> = {};
  for (const item of numericFields(draft)) {
    const parsed = positiveInt(item.text, item.label, item.max);
    if (parsed.error) errors[item.field] = parsed.error;
    if (parsed.value !== undefined) numbers[item.field] = parsed.value;
  }
  return numbers;
}

function mapIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): FieldErrors {
  const mapped: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.find((part) => typeof part === "string" && part in PATH_FIELD);
    const field = key === undefined ? "mailboxes" : PATH_FIELD[String(key)];
    if (field !== undefined && mapped[field] === undefined) mapped[field] = issue.message;
  }
  return mapped;
}

export function buildCreateBody(draft: CreateDraft, nowMs: number): { ok: true; body: ShareLinkCreate } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const numbers = collectNumbers(draft, errors);
  if (draft.mailboxes.length === 0) errors.mailboxes = "至少选择一个收件地址";
  if (draft.ruleGroupId === null) errors.ruleGroupId = "请选择规则组";
  const expiry = EXPIRY_BUILDERS[draft.expiry](draft, Math.floor(nowMs / MS_PER_SECOND), errors);
  if (Object.keys(errors).length > 0 || draft.ruleGroupId === null) return { ok: false, errors };

  const candidate: ShareLinkCreate = {
    mode: draft.mode,
    mailbox_ids: draft.mailboxes.map((item) => item.id),
    rule_group_id: draft.ruleGroupId,
    status: "active",
    name: BLANK_TO_UNDEFINED(draft.name),
    order_ref: BLANK_TO_UNDEFINED(draft.orderRef),
    public_title: BLANK_TO_UNDEFINED(draft.publicTitle),
    public_note: BLANK_TO_UNDEFINED(draft.publicNote),
    ...expiry,
    access: {
      ...(BLANK_TO_UNDEFINED(draft.password) === undefined ? {} : { password: draft.password }),
      turnstile: draft.turnstile,
      max_devices: numbers.maxDevices,
      reveal: effectiveReveal(draft),
      max_deliveries_total: numbers.maxTotal,
      max_deliveries_per_day: numbers.maxPerDay,
      ip_allow: splitList(draft.ipAllow),
      country_allow: splitList(draft.countryAllow),
      poll_interval_sec: numbers.pollInterval,
    },
  };
  const checked = shareLinkCreateSchema.safeParse(candidate);
  // 发送 schema 规范化后的结果（IP 写法统一、国家代码大写），与服务端看到的一致
  if (checked.success) return { ok: true, body: checked.data };
  return { ok: false, errors: mapIssues(checked.error.issues) };
}
