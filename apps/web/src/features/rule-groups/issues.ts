import { parseIssueList } from "./issues-schema";
import type { RuleGroupIssue } from "@maillink/shared";
import { isApiError } from "../../api/errors";

// 把校验问题（带 path）映射到字段：每个字段只取指向自己（及其子路径）的问题，
// 没有对应控件的问题由编辑器顶部的“全部问题”清单兜底，不会丢。

export type PathLike = ReadonlyArray<string | number>;

export function startsWithPath(path: PathLike, prefix: PathLike): boolean {
  return prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment);
}

/** 指向 prefix 本身或其子路径的问题 */
export function issuesAt(issues: readonly RuleGroupIssue[], prefix: PathLike): RuleGroupIssue[] {
  return issues.filter((issue) => startsWithPath(issue.path, prefix));
}

/** 只指向 path 本身的问题 */
export function issuesExactlyAt(issues: readonly RuleGroupIssue[], path: PathLike): RuleGroupIssue[] {
  return issues.filter((issue) => issue.path.length === path.length && startsWithPath(issue.path, path));
}

export function errorsOf(issues: readonly RuleGroupIssue[]): RuleGroupIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}

export function warningsOf(issues: readonly RuleGroupIssue[]): RuleGroupIssue[] {
  return issues.filter((issue) => issue.severity === "warning");
}

/** 一条规则的问题拆成：每个条件行各自的 + 属于规则卡片整体的（名称、effect、嵌套深度、空分组等） */
export function splitRuleIssues(
  ruleIssues: readonly RuleGroupIssue[],
  rulePath: PathLike,
  shape: "leaf" | "group" | "nested",
  leafCount: number,
): { rows: RuleGroupIssue[][]; card: RuleGroupIssue[] } {
  const whenPath = [...rulePath, "when"];
  const rows: RuleGroupIssue[][] = Array.from({ length: leafCount }, () => []);
  const card: RuleGroupIssue[] = [];
  for (const issue of ruleIssues) {
    const index = rowIndexOf(issue.path, whenPath, shape);
    if (index === null || index >= leafCount) card.push(issue);
    else rows[index]?.push(issue);
  }
  return { rows, card };
}

/** 问题属于第几个条件行；不属于任何一行返回 null */
function rowIndexOf(path: PathLike, whenPath: PathLike, shape: "leaf" | "group" | "nested"): number | null {
  if (shape === "nested") return null;
  if (shape === "leaf") return path.length > whenPath.length && startsWithPath(path, whenPath) ? 0 : null;
  const index = path[whenPath.length + 1];
  const isRow = startsWithPath(path, whenPath) && (path[whenPath.length] === "all" || path[whenPath.length] === "any");
  return isRow && typeof index === "number" ? index : null;
}

/** 服务端 400 `rule_group_invalid` 的 issues / warnings（ApiError.details）；形状不对返回 null，不猜 */
export function issuesFromApiError(error: unknown): { errors: RuleGroupIssue[]; warnings: RuleGroupIssue[] } | null {
  if (!isApiError(error, "rule_group_invalid")) return null;
  const errors = parseIssueList(error.details.issues);
  const warnings = parseIssueList(error.details.warnings);
  return errors === null || warnings === null ? null : { errors, warnings };
}
