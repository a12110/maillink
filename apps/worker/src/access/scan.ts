import type { RuleEvaluation } from "@maillink/shared";
import { LIST_PAGE_SIZE, MAX_PARSE_PER_REQUEST, SCAN_CAP_PER_REQUEST } from "../constants";
import { getOrBuild, type MailIndexDbs } from "../mail-index";
import type { MailFacts } from "../mail-parse";
import type { MailCandidate } from "../mail-source";
import type { CompiledRuleGroup } from "../rules";
import { evaluateIndexed } from "./policy";

// 02 §5 的扫描循环：按 id 顺序一批批取候选（地址、时间下界、游标已下推进 SQL）→ getOrBuild → 求值，
// 直到凑满目标数 / 触到 SCAN_CAP_PER_REQUEST / 没有更多 / 遇到本次没解析到的邮件。
// 遇到 pending 立即停：它之后的邮件都不算处理过，游标与 after_id 只能停在它前面，保证不漏。

export type VisibleEntry = { mail_id: number; received_at: number; facts: MailFacts; evaluation: RuleEvaluation };

/** 取下一批候选：afterCursor 为上一批最后一封的 id（首批为 null），返回按扫描方向排好序的候选 */
export type FetchBatch = (afterCursor: number | null, limit: number) => Promise<MailCandidate[]>;

export type ScanResult = {
  visible: VisibleEntry[];
  /** 按扫描顺序第一封未就绪的邮件；有它时 partial */
  pending: MailCandidate | null;
  /** 第一封被扫描到的候选 id（不论是否可见），首页用来给出轮询起点 */
  firstScannedId: number | null;
  /** 最后一封处理完（已判定）的候选 id；pending 之前的最后一封 */
  lastScannedId: number | null;
  /** 候选已全部扫完 */
  exhausted: boolean;
};

type ScanState = ScanResult & { scanned: number; parseBudget: number };

export async function scanVisible(
  dbs: MailIndexDbs,
  compiled: CompiledRuleGroup,
  lowerBound: number | null,
  fetch: FetchBatch,
  target: number,
): Promise<ScanResult> {
  const state: ScanState = {
    visible: [],
    pending: null,
    firstScannedId: null,
    lastScannedId: null,
    exhausted: false,
    scanned: 0,
    parseBudget: MAX_PARSE_PER_REQUEST,
  };
  while (state.visible.length < target && state.scanned < SCAN_CAP_PER_REQUEST) {
    const limit = Math.min(LIST_PAGE_SIZE, SCAN_CAP_PER_REQUEST - state.scanned);
    const batch = await fetch(state.lastScannedId, limit);
    state.firstScannedId ??= batch[0]?.id ?? null;
    if (batch.length === 0) {
      state.exhausted = true;
      break;
    }
    const stop = await processBatch(dbs, compiled, lowerBound, batch, target, state);
    if (stop) break;
    if (batch.length < limit) {
      state.exhausted = true;
      break;
    }
  }
  const { visible, pending, firstScannedId, lastScannedId, exhausted } = state;
  return { visible, pending, firstScannedId, lastScannedId, exhausted };
}

/** 处理一批；返回 true 表示应停止扫描（遇到 pending 或凑满目标数） */
async function processBatch(
  dbs: MailIndexDbs,
  compiled: CompiledRuleGroup,
  lowerBound: number | null,
  batch: MailCandidate[],
  target: number,
  state: ScanState,
): Promise<boolean> {
  const built = await getOrBuild(dbs, batch, { maxParse: state.parseBudget });
  state.parseBudget -= built.attempted;
  const items = new Map(built.items.map((item) => [item.candidate.id, item]));
  for (const candidate of batch) {
    state.scanned += 1;
    const item = items.get(candidate.id);
    if (item?.status === "pending") {
      state.pending = candidate;
      return true;
    }
    state.lastScannedId = candidate.id;
    // 不在结果里 = 原文已从 MAIL_DB 删除；解析失败一律不可见
    if (item === undefined || item.status === "failed") continue;
    const evaluation = evaluateIndexed(compiled, item, lowerBound);
    if (!evaluation.visible) continue;
    state.visible.push({ mail_id: candidate.id, received_at: candidate.received_at, facts: item.facts, evaluation });
    if (state.visible.length >= target) return true;
  }
  return false;
}
