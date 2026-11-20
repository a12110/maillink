import { EMAIL_MAX_LENGTH, RULE_GROUP_API_LIMITS } from "@maillink/shared";
import type { RuleGroupTestItem, RuleGroupTestRequest } from "@maillink/shared";

export type TesterTarget = { kind: "addresses"; addresses: string[] } | { kind: "mail_ids"; mailIds: number[] };

export type ParsedTarget = { ok: true; target: TesterTarget } | { ok: false; error: string | null };

/** 输入框内容：只有数字（可逗号 / 空白分隔）→ 邮件 id；否则当作一个收件地址。空串不报错（还没填） */
export function parseTarget(text: string): ParsedTarget {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: null };
  if (/^[\d\s,，]+$/u.test(trimmed)) {
    const ids = trimmed.split(/[\s,，]+/u).filter((part) => part !== "").map(Number);
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return { ok: false, error: "邮件 id 必须是正整数" };
    if (ids.length > RULE_GROUP_API_LIMITS.testMaxTargets) return { ok: false, error: `一次最多 ${RULE_GROUP_API_LIMITS.testMaxTargets} 个邮件 id` };
    return { ok: true, target: { kind: "mail_ids", mailIds: [...new Set(ids)] } };
  }
  if (trimmed.length > EMAIL_MAX_LENGTH) return { ok: false, error: "收件地址过长" };
  return { ok: true, target: { kind: "addresses", addresses: [trimmed] } };
}

export function buildTestRequest(config: Record<string, unknown>, target: TesterTarget, anchorAt: number | undefined): RuleGroupTestRequest {
  const base = { config, ...(anchorAt === undefined ? {} : { anchor_at: anchorAt }) };
  return target.kind === "addresses" ? { ...base, addresses: target.addresses } : { ...base, mail_ids: target.mailIds };
}

export type TestSummary = { total: number; visible: number; hidden: number };

export function summarizeItems(items: readonly RuleGroupTestItem[]): TestSummary {
  const visible = items.filter((item) => item.visible).length;
  return { total: items.length, visible, hidden: items.length - visible };
}
