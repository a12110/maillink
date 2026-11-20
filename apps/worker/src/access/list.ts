import type { PresentedMail, VisibleMailListResponse } from "@maillink/shared";
import { LIST_PAGE_SIZE } from "../constants";
import { mailIdentity, type MailIdentity, type MailIndexDbs } from "../mail-index";
import { listAfter, listCandidates } from "../mail-source";
import { presentListItem } from "../render";
import { limitToNewest, type CompiledRuleGroup } from "../rules";
import { effectivePolicy, type AccessScope } from "./policy";
import { scanNewestVisible } from "./newest";
import { scanVisible, type FetchBatch, type ParseBudget, type ScanResult, type VisibleEntry } from "./scan";

// 邮件列表（02 §5）：时间下界 + 地址 + 游标下推 → getOrBuild → 状态分流 → evaluate → 循环 → max_mails → present。
//
// 两种模式：
//   - 翻页（cursor，id < cursor，新的在前）；
//   - 增量轮询（after_id，id > after_id）。
// limits.max_mails 设了时"只保留最新的 N 封，没有更多分页"：两种模式都走 scanNewestVisible（首页 N 封），
// 轮询只返回其中 id > after_id 的；next_cursor 恒为 null，带 cursor 的请求返回空。
// partial=true 时：翻页的 next_cursor 指向未就绪邮件本身（下一页从它开始）；增量轮询的 next_after_id 不越过它。

export type ListVisibleOptions = {
  /** 上一页响应的 next_cursor（十进制 id） */
  cursor?: string;
  afterId?: number;
  /** 当前时间，Unix 秒 */
  now: number;
  /** 可选：与同一请求里的其他作用域共用的解析预算；不给时本次调用独享 MAX_PARSE_PER_REQUEST */
  parseBudget?: ParseBudget;
};

const CURSOR_PATTERN = /^[1-9]\d{0,14}$/u;

/** 翻页游标 → id；没给为 null。路由边界已校验格式，这里再判一次防止调用方漏校验 */
function parseCursor(options: ListVisibleOptions): number | null {
  const { cursor } = options;
  if (cursor === undefined) return null;
  if (options.afterId !== undefined) throw new RangeError("cursor 与 afterId 不能同时使用");
  if (!CURSOR_PATTERN.test(cursor)) throw new RangeError(`cursor 无效：${cursor}`);
  return Number(cursor);
}

/**
 * 列表结果，外加不进响应体的两份对照（都以 mail id 为键）：
 * recipients：收件地址（全小写），供用户收件箱把邮件对回授权；identities：邮件身份，供取件链接核对取码记录。
 */
export type TaggedVisibleList = {
  response: VisibleMailListResponse;
  recipients: Map<number, string>;
  identities: Map<number, MailIdentity>;
};

function present(compiled: CompiledRuleGroup, entries: readonly VisibleEntry[]): PresentedMail[] {
  return entries.map((entry) =>
    // 可见的邮件一定做过提取（只有 parse_failed / out_of_window 时 extracted 为 null）
    presentListItem(compiled.presentation, entry.facts, entry.evaluation.extracted ?? missingExtraction(entry.mail_id)),
  );
}

function tagged(response: Omit<VisibleMailListResponse, "items">, compiled: CompiledRuleGroup, entries: readonly VisibleEntry[]): TaggedVisibleList {
  return {
    response: { ...response, items: present(compiled, entries) },
    recipients: new Map(entries.map((entry) => [entry.mail_id, entry.recipient])),
    identities: new Map(entries.map((entry) => [entry.mail_id, mailIdentity(entry)])),
  };
}

export async function listVisibleMails(
  dbs: MailIndexDbs,
  scope: AccessScope,
  options: ListVisibleOptions,
): Promise<VisibleMailListResponse> {
  return (await listVisibleMailsTagged(dbs, scope, options)).response;
}

export async function listVisibleMailsTagged(
  dbs: MailIndexDbs,
  scope: AccessScope,
  options: ListVisibleOptions,
): Promise<TaggedVisibleList> {
  const beforeId = parseCursor(options);
  const { compiled, lowerBound } = effectivePolicy(scope, options.now);
  const maxMails = compiled.config.limits.max_mails;
  if (scope.addresses.length === 0 || (maxMails !== undefined && beforeId !== null)) {
    return tagged({ next_cursor: null, partial: false, next_after_id: options.afterId ?? null }, compiled, []);
  }
  if (maxMails !== undefined) {
    const { entries, scan } = await scanNewestVisible(dbs, scope.addresses, compiled, lowerBound, maxMails, options.parseBudget);
    const afterId = options.afterId ?? 0;
    const meta = { next_cursor: null, partial: scan.pending !== null, next_after_id: firstPageWatermark(scan, null) };
    return tagged(meta, compiled, entries.filter((entry) => entry.mail_id > afterId));
  }

  const fetch = batchFetcher(dbs, scope.addresses, lowerBound, options.afterId, beforeId);
  const scan = await scanVisible(dbs, compiled, lowerBound, fetch, LIST_PAGE_SIZE, options.parseBudget);
  const entries = limitToNewest(scan.visible, undefined);
  const partial = scan.pending !== null;
  if (options.afterId !== undefined) {
    return tagged({ next_cursor: null, partial, next_after_id: scan.lastScannedId ?? options.afterId }, compiled, entries);
  }
  return tagged({ next_cursor: nextCursor(scan), partial, next_after_id: firstPageWatermark(scan, beforeId) }, compiled, entries);
}

/** 增量轮询按 id 正序取 id > after_id；翻页按 id 倒序取 id < cursor。地址与时间下界都下推进 SQL */
function batchFetcher(
  dbs: MailIndexDbs,
  addresses: string[],
  since: number | null,
  afterId: number | undefined,
  beforeId: number | null,
): FetchBatch {
  if (afterId !== undefined) {
    return (last, limit) => listAfter(dbs.MAIL_DB, { addresses, afterId: last ?? afterId, since, limit });
  }
  return (last, limit) => listCandidates(dbs.MAIL_DB, { addresses, since, beforeId: last ?? beforeId, limit });
}

function missingExtraction(mailId: number): never {
  throw new Error(`mail ${mailId}: 可见却没有提取结果`);
}

function nextCursor(scan: ScanResult): string | null {
  if (scan.pending !== null) return String(scan.pending.id + 1);
  if (scan.exhausted || scan.lastScannedId === null) return null;
  return String(scan.lastScannedId);
}

/**
 * 首页给出增量轮询的起点：扫描到的最新候选 id（不论可见与否）；没有任何候选时为 0（时间下界之前的邮件不会再变成候选）。
 * partial 时为 null：未就绪的邮件可能比起点旧，前端应先重取首页。翻页（带 cursor）不给。
 */
function firstPageWatermark(scan: ScanResult, beforeId: number | null): number | null {
  if (beforeId !== null || scan.pending !== null) return null;
  return scan.firstScannedId ?? 0;
}
