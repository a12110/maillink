import { MAX_PARSE_PER_REQUEST, PARSER_VERSION } from "../constants";
import { rowCodeSource, rowToFacts } from "../mail-parse";
import type { CodeSource, MailFacts, MailIndexRow } from "../mail-parse";
import { parseMail, MailParseError } from "../mail-parse";
import { getRawBatch } from "../mail-source";
import type { MailCandidate, MailDbBinding, RawMailResult } from "../mail-source";
import { nowSec } from "../clock";
import { sameMailIdentity } from "./identity";
import { buildFailedRow, buildOkRow, findIndexRows, upsertIndexRows } from "./rows";

export { findIndexRows } from "./rows";
export { mailIdentity, sameMailIdentity, type MailIdentity } from "./identity";

export type MailIndexDbs = { APP_DB: D1Database } & MailDbBinding;

/**
 * 一封候选邮件在索引里的状态。调用方必须先判 status 再用内容：
 * - ok：facts 可用于规则判定；
 * - failed：解析失败，没有 facts（空 facts 会让 deny 规则全部不命中，即失败开放），用户侧必须隐藏；
 * - pending：本次请求没轮到解析（超出 MAX_PARSE_PER_REQUEST），"未就绪"。
 */
export type IndexedItem =
  | { status: "ok"; candidate: MailCandidate; row: MailIndexRow; facts: MailFacts; code_source: CodeSource | null }
  | { status: "failed"; candidate: MailCandidate; row: MailIndexRow; error: string }
  | { status: "pending"; candidate: MailCandidate };

export type GetOrBuildResult = {
  /** 与输入顺序一致；MAIL_DB 里已被删除的邮件不在其中 */
  items: IndexedItem[];
  /** 有邮件未就绪，调用方响应里带 partial: true，前端稍后重取 */
  partial: boolean;
  /** 本次现场解析（尝试）的封数；多次调用的调用方据此控制单次请求的总解析量 */
  attempted: number;
};

/** 索引行可直接使用：邮件身份（message_id、received_at、recipient）与候选一致，且解析器版本是当前版本（01 §4.2） */
export function isFresh(row: MailIndexRow, candidate: MailCandidate): boolean {
  return row.parser_version === PARSER_VERSION && sameMailIdentity(row, candidate);
}

/** 解析取回的原文，生成要写回索引的行。MAIL_DB 里已不存在的邮件（不在 rawResults 里）不产生行 */
async function buildRows(rawResults: readonly RawMailResult[], candidates: readonly MailCandidate[], now: number): Promise<MailIndexRow[]> {
  const raws = new Map(rawResults.map((raw) => [raw.id, raw]));
  const rows: MailIndexRow[] = [];
  for (const candidate of candidates) {
    const raw = raws.get(candidate.id);
    if (!raw) continue;
    if (!raw.ok) {
      rows.push(buildFailedRow(candidate, raw.error, now));
      continue;
    }
    try {
      rows.push(buildOkRow(candidate, await parseMail({ candidate, raw: raw.raw, metadata: raw.metadata }), now));
    } catch (error) {
      // 只有"邮件本身不可解析"才落成 failed；其他异常是代码缺陷，直接抛出（Debug-First）
      if (!(error instanceof MailParseError)) throw error;
      rows.push(buildFailedRow(candidate, error.message, now));
    }
  }
  return rows;
}

function toItem(candidate: MailCandidate, row: MailIndexRow): IndexedItem {
  if (row.parse_status === "failed") {
    return { status: "failed", candidate, row, error: row.parse_error ?? "解析失败（未记录原因）" };
  }
  return { status: "ok", candidate, row, facts: rowToFacts(row), code_source: rowCodeSource(row) };
}

/**
 * 候选 → 解析好的邮件（01 §4.2）。
 * 命中且新鲜的索引行直接用；其余的取原文解析并写回，单次最多解析 maxParse 封，剩下的返回"未就绪"。
 * 过期（版本旧、id 被复用）的行即使没轮到重建也不返回，免得拿旧解析结果做判定。
 */
export async function getOrBuild(
  dbs: MailIndexDbs,
  candidates: readonly MailCandidate[],
  options: { maxParse?: number } = {},
): Promise<GetOrBuildResult> {
  const existing = await findIndexRows(dbs.APP_DB, candidates.map((candidate) => candidate.id));
  const stale = candidates.filter((candidate) => {
    const row = existing.get(candidate.id);
    return !row || !isFresh(row, candidate);
  });
  const toBuild = stale.slice(0, options.maxParse ?? MAX_PARSE_PER_REQUEST);
  const rawResults = await getRawBatch(dbs.MAIL_DB, toBuild.map((candidate) => candidate.id));
  const built = await buildRows(rawResults, toBuild, nowSec());
  await upsertIndexRows(dbs.APP_DB, built);

  const builtById = new Map(built.map((row) => [row.mail_id, row]));
  const staleIds = new Set(stale.map((candidate) => candidate.id));
  const attemptedIds = new Set(toBuild.map((candidate) => candidate.id));
  const items: IndexedItem[] = [];
  for (const candidate of candidates) {
    const row = staleIds.has(candidate.id) ? builtById.get(candidate.id) : existing.get(candidate.id);
    if (row) items.push(toItem(candidate, row));
    // 轮到解析但原文已不在 MAIL_DB：邮件被删了，不返回；没轮到的才是"未就绪"
    else if (!attemptedIds.has(candidate.id)) items.push({ status: "pending", candidate });
  }
  return { items, partial: items.some((item) => item.status === "pending"), attempted: toBuild.length };
}
