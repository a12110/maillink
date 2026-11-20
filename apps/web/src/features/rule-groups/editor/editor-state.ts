import { RULE_GROUP_API_LIMITS, validateRuleGroupConfig } from "@maillink/shared";
import type { RuleGroupIssue } from "@maillink/shared";
import { asFormConfig, countChanges } from "../config";
import { errorsOf, warningsOf } from "../issues";

export type EditorMode = "form" | "json";

/** 编辑器的可保存内容；baseline 是“上次保存（或刚加载）的样子”，未保存标记与放弃更改都以它为准 */
export type EditorContent = { name: string; description: string; config: unknown };

export type JsonParse = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

export function parseJsonConfig(text: string): JsonParse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    return { ok: false, error: `JSON 语法错误：${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "配置必须是一个 JSON 对象（以 { 开头）" };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

export function prettyJson(config: unknown): string {
  return JSON.stringify(config, null, 2);
}

const issueKey = (issue: RuleGroupIssue) => `${issue.code}|${issue.path.join(".")}`;

/** 本地校验 + 服务端保存时返回的问题（如试跑计时才发现的 regex_too_slow）合并，去重 */
export function mergeIssues(local: readonly RuleGroupIssue[], server: readonly RuleGroupIssue[]): RuleGroupIssue[] {
  const seen = new Set(local.map(issueKey));
  return [...local, ...server.filter((issue) => !seen.has(issueKey(issue)))];
}

/** 即时校验：与保存同一个 validateRuleGroupConfig；正则试跑计时留给服务端保存时做（逐键盘事件试跑太慢） */
export function validateLive(config: unknown): RuleGroupIssue[] {
  const result = validateRuleGroupConfig(config, { regexProbe: "skip" });
  return [...errorsOf(result.errors), ...warningsOf(result.warnings)];
}

export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "名称不能为空";
  if (trimmed.length > RULE_GROUP_API_LIMITS.nameMaxLength) return `名称最长 ${RULE_GROUP_API_LIMITS.nameMaxLength} 个字符`;
  return null;
}

export function descriptionProblem(description: string): string | null {
  const length = description.trim().length;
  return length > RULE_GROUP_API_LIMITS.descriptionMaxLength ? `说明最长 ${RULE_GROUP_API_LIMITS.descriptionMaxLength} 个字符` : null;
}

/** “N 处未保存”：名称、说明各算一处，配置按 countChanges（规则按条算）。表单会补默认值，所以两边都先规范化再比 */
export function countEditorChanges(current: EditorContent, baseline: EditorContent): number {
  const normalize = (config: unknown) => asFormConfig(config) ?? config;
  const meta = (current.name !== baseline.name ? 1 : 0) + (current.description !== baseline.description ? 1 : 0);
  return meta + countChanges(normalize(baseline.config), normalize(current.config));
}
