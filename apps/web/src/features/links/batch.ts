import { SHARE_LINK_LIMITS } from "@maillink/shared";
import type { ShareLinkBatch, ShareLinkBatchResponse } from "@maillink/shared";
import { unitSeconds } from "./labels";
import type { ExtendUnit } from "./labels";

// 批量操作的请求组装与结果解读（纯函数，便于测试）。单条操作也走批量接口（ids 只有一个）。

/** 批量接口对没改动的链接给的原因 → 中文 */
const BATCH_ERROR_LABEL: Record<string, string> = {
  not_found: "链接不存在（可能已被删除）",
  link_revoked: "已撤销，撤销是终态，不能再改",
  not_active: "当前不是生效状态，不能暂停",
  not_paused: "当前不是暂停状态，不能恢复",
  no_deadline: "这个链接目前没有截止时间，无法延长",
  unchanged: "没有变化（已经是目标状态）",
};

export function describeBatchError(code: string | undefined): string {
  if (code === undefined) return "未知原因";
  return BATCH_ERROR_LABEL[code] ?? code;
}

export type ExtendInput = { amount: string; unit: ExtendUnit };

/** 延长多久：正整数 × 单位，不超过后端上限；不合法返回原因 */
export function parseExtend(input: ExtendInput): { ok: true; seconds: number } | { ok: false; error: string } {
  const text = input.amount.trim();
  if (!/^\d+$/u.test(text)) return { ok: false, error: "请输入正整数" };
  const seconds = Number(text) * unitSeconds(input.unit);
  if (seconds < 1) return { ok: false, error: "至少延长 1 个单位" };
  if (seconds > SHARE_LINK_LIMITS.durationMaxSec) return { ok: false, error: "最多延长 10 年" };
  return { ok: true, seconds };
}

export const buildBatch = {
  pause: (ids: number[]): ShareLinkBatch => ({ ids, action: "pause" }),
  resume: (ids: number[]): ShareLinkBatch => ({ ids, action: "resume" }),
  revoke: (ids: number[]): ShareLinkBatch => ({ ids, action: "revoke" }),
  extend: (ids: number[], seconds: number): ShareLinkBatch => ({ ids, action: "extend", extend_sec: seconds }),
  setRuleGroup: (ids: number[], ruleGroupId: number): ShareLinkBatch => ({ ids, action: "set_rule_group", rule_group_id: ruleGroupId }),
};

export type BatchSummary = {
  ok: number;
  failed: Array<{ id: number; message: string }>;
};

export function summarizeBatch(response: ShareLinkBatchResponse): BatchSummary {
  const failed = response.results.filter((result) => !result.ok).map((result) => ({ id: result.id, message: describeBatchError(result.error) }));
  return { ok: response.results.length - failed.length, failed };
}
