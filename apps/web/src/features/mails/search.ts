import { mailScopeSchema } from "@maillink/shared";
import type { AdminMailListQuery, MailScope } from "@maillink/shared";
import { z } from "zod";
import { MAILS_PAGE_SIZE, MAIL_FILTER_TEXT_MAX, MS_PER_SECOND } from "../../constants";

// /admin/mails 的 URL search params：筛选条件（与后端查询参数同名，便于从别处直接拼链接）+ 选中的邮件 id。
// 路由默认把纯数字参数 JSON 解析成 number，所以文本字段同时接受 string 与 number。

/** 9999-12-31 23:59:59 UTC，与后端 adminMailListQuerySchema 一致 */
const MAX_UNIX_SECONDS = 253_402_300_799;
const SECONDS_PER_MINUTE = 60;
const LAST_SECOND_OF_MINUTE = SECONDS_PER_MINUTE - 1;

const blankToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);

const filterText = z.preprocess(
  blankToUndefined,
  z
    .union([z.string(), z.number()])
    .transform(String)
    .pipe(z.string().trim().max(MAIL_FILTER_TEXT_MAX))
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
);
const unixSeconds = z.preprocess(
  blankToUndefined,
  z.coerce.number().int().nonnegative().max(MAX_UNIX_SECONDS).optional(),
);
const mailId = z.preprocess(blankToUndefined, z.coerce.number().int().positive().safe().optional());

export const mailsSearchSchema = z
  .object({
    /** 邮件头收件人（列表里的“收件地址”） */
    to_address: filterText,
    /** 信封收件人 */
    address: filterText,
    /** 信封发件人 */
    source: filterText,
    since: unixSeconds,
    until: unixSeconds,
    scope: z.preprocess(blankToUndefined, mailScopeSchema.optional()),
    /** 选中的邮件（详情） */
    id: mailId,
  })
  .refine((search) => search.since === undefined || search.until === undefined || search.since <= search.until, {
    message: "开始时间不能晚于结束时间",
  });

export type MailsSearch = z.output<typeof mailsSearchSchema>;
export type MailFilters = Omit<MailsSearch, "id">;

export const NO_FILTERS: MailFilters = {};

/** 路由的 validateSearch：非法参数直接抛错（走路由错误页），不静默忽略 */
export function parseMailsSearch(raw: Record<string, unknown>): MailsSearch {
  const result = mailsSearchSchema.safeParse(raw);
  if (result.success) return result.data;
  const detail = result.error.issues.map((issue) => `${issue.path.join(".") || "(整体)"}：${issue.message}`).join("；");
  throw new Error(`URL 筛选参数不合法（${detail}）`);
}

const FILTER_KEYS = ["to_address", "address", "source", "since", "until", "scope"] as const;

/**
 * 只保留已知的筛选键，并去掉 undefined；范围 all 是默认值，不写进 URL。
 * （路由给子路由的 search 里还带着没声明的参数，如 ?theme=dark，不能算进筛选条件）
 */
export function normalizeFilters(filters: MailFilters): MailFilters {
  const kept: Record<string, unknown> = {};
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value !== undefined && !(key === "scope" && value === "all")) kept[key] = value;
  }
  return kept as MailFilters;
}

export function filtersOf(search: MailsSearch): MailFilters {
  return normalizeFilters(search);
}

export function hasActiveFilters(filters: MailFilters): boolean {
  return Object.keys(normalizeFilters(filters)).length > 0;
}

/** 列表请求的缓存键：筛选条件变了就重新从第一页开始 */
export function filtersKey(filters: MailFilters): string {
  return JSON.stringify(Object.entries(normalizeFilters(filters)).sort(([a], [b]) => a.localeCompare(b)));
}

export function toListQuery(filters: MailFilters, cursor: string | undefined): AdminMailListQuery {
  return {
    address: filters.address,
    to_address: filters.to_address,
    source: filters.source,
    since: filters.since,
    until: filters.until,
    scope: filters.scope ?? "all",
    cursor,
    limit: MAILS_PAGE_SIZE,
  };
}

export const SCOPE_LABEL: Record<MailScope, string> = {
  all: "全部地址",
  imported: "已导入地址",
  unknown: "未知地址",
};

// ── 时间范围：URL 里是 Unix 秒，输入框是本地 `YYYY-MM-DDTHH:mm`（分钟精度）──

const PAD = 2;
const pad = (value: number) => String(value).padStart(PAD, "0");

export function unixToLocalInput(unixSec: number | undefined): string {
  if (unixSec === undefined) return "";
  const d = new Date(unixSec * MS_PER_SECOND);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 开始时间取该分钟的第 0 秒，结束时间取第 59 秒（后端范围含边界）；空串或不合法返回 undefined */
export function localInputToUnix(value: string, edge: "start" | "end"): number | undefined {
  if (value === "") return undefined;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return undefined;
  return Math.floor(ms / MS_PER_SECOND) + (edge === "end" ? LAST_SECOND_OF_MINUTE : 0);
}

/**
 * 输入框的值 → URL 里的秒数。输入框没被改动（和 URL 值显示一样）时沿用 URL 的原值，
 * 免得手写的 `since=1700000001` 被取整到分钟。
 */
export function resolveTime(input: string, current: number | undefined, edge: "start" | "end"): number | undefined {
  if (input === unixToLocalInput(current)) return current;
  return localInputToUnix(input, edge);
}

// ── 筛选栏草稿：输入框里的字符串 ↔ URL 里的筛选条件 ──

export type FilterDraft = {
  to_address: string;
  address: string;
  source: string;
  since: string;
  until: string;
};

export function draftOf(filters: MailFilters): FilterDraft {
  return {
    to_address: filters.to_address ?? "",
    address: filters.address ?? "",
    source: filters.source ?? "",
    since: unixToLocalInput(filters.since),
    until: unixToLocalInput(filters.until),
  };
}

export type DraftResult = { ok: true; filters: MailFilters } | { ok: false; error: string };

/** 草稿 → 筛选条件；不合法（过长、开始晚于结束）不提交，把原因返回给界面显示 */
export function applyDraft(draft: FilterDraft, current: MailFilters): DraftResult {
  const texts = [draft.to_address, draft.address, draft.source].map((value) => value.trim());
  if (texts.some((value) => value.length > MAIL_FILTER_TEXT_MAX)) {
    return { ok: false, error: `地址与发件人不能超过 ${MAIL_FILTER_TEXT_MAX} 个字符` };
  }
  const since = resolveTime(draft.since, current.since, "start");
  const until = resolveTime(draft.until, current.until, "end");
  if (since !== undefined && until !== undefined && since > until) {
    return { ok: false, error: "开始时间不能晚于结束时间" };
  }
  const [to_address, address, source] = texts.map((value) => (value === "" ? undefined : value));
  return { ok: true, filters: normalizeFilters({ to_address, address, source, since, until, scope: current.scope }) };
}

/** 判断草稿与 URL 是否已一致（用于决定要不要把 URL 的变化同步回输入框） */
export function draftKey(draft: FilterDraft): string {
  return JSON.stringify(draft);
}
