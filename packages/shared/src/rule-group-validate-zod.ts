import type { z } from "zod";
import { COND_BRANCH_KEYS } from "./rule-group";
import { ruleGroupError, type RuleGroupIssue, type RuleGroupIssuePath } from "./rule-group-issues";

// 把 zod 的结构错误翻译成带路径的中文说明。
// union（条件、links、value）失败时 zod 给出每个分支的错误；这里按输入的形状挑出"用户显然想写的那个分支"，
// 只报那个分支的错误，避免把四个分支的错误全堆给用户。

type ZodIssue = z.core.$ZodIssue;

const EXPECTED_ZH: Record<string, string> = {
  string: "文本",
  number: "数字",
  int: "整数",
  boolean: "布尔值",
  array: "数组",
  object: "对象",
};

export function mapZodIssues(issues: readonly ZodIssue[], input: unknown, prefix: RuleGroupIssuePath = []): RuleGroupIssue[] {
  return issues.flatMap((issue) => mapIssue(issue, input, prefix));
}

function mapIssue(issue: ZodIssue, input: unknown, prefix: RuleGroupIssuePath): RuleGroupIssue[] {
  const path: RuleGroupIssuePath = [...prefix, ...issue.path.map((s) => (typeof s === "number" ? s : String(s)))];
  if (issue.code !== "unrecognized_keys" && path.length > 0 && valueAt(input, path) === undefined) {
    return [ruleGroupError("required", path, `缺少必填字段"${String(path[path.length - 1])}"`)];
  }
  switch (issue.code) {
    case "invalid_union":
      return mapUnion(issue.errors, input, path);
    case "unrecognized_keys":
      return issue.keys.map((key) =>
        ruleGroupError("unknown_field", [...path, key], `不认识的字段"${key}"（拼写错误，或这个位置不允许该字段）`),
      );
    case "invalid_type":
      return [typeIssue(issue.expected, path)];
    case "invalid_value":
      return [
        ruleGroupError(
          "invalid_value",
          path,
          `取值不在允许范围内，可选：${issue.values.map((v) => JSON.stringify(v)).join("、")}`,
        ),
      ];
    case "too_small":
      return [ruleGroupError("out_of_range", path, tooSmallMessage(issue.origin, Number(issue.minimum)))];
    case "too_big":
      return [ruleGroupError("out_of_range", path, tooBigMessage(issue.origin, Number(issue.maximum)))];
    default:
      return [ruleGroupError("invalid_value", path, `取值不正确：${issue.message}`)];
  }
}

function typeIssue(expected: string, path: RuleGroupIssuePath): RuleGroupIssue {
  return ruleGroupError("invalid_type", path, `类型不正确：应为${EXPECTED_ZH[expected] ?? expected}`);
}

function tooSmallMessage(origin: string, min: number): string {
  if (origin === "string") return min <= 1 ? "不能为空" : `长度至少 ${min} 个字符`;
  if (origin === "array" || origin === "set") return `至少需要 ${min} 项`;
  return `不能小于 ${min}`;
}

function tooBigMessage(origin: string, max: number): string {
  if (origin === "string") return `长度不能超过 ${max} 个字符`;
  if (origin === "array" || origin === "set") return `最多 ${max} 项`;
  return `不能大于 ${max}`;
}

function mapUnion(branches: ZodIssue[][], input: unknown, path: RuleGroupIssuePath): RuleGroupIssue[] {
  const branch = pickBranch(branches, valueAt(input, path), path);
  if (branch) return mapZodIssues(branch, input, path);
  if (isCondPath(path)) {
    return [
      ruleGroupError(
        "invalid_condition",
        path,
        "条件必须是 { all: [...] }、{ any: [...] }、{ not: {...} } 或字段条件 { field, op, value } 之一",
      ),
    ];
  }
  const last = path[path.length - 1];
  if (last === "links") {
    return [ruleGroupError("invalid_value", path, 'links 只能是 "keep"、"strip" 或 { "allow_domains": [...] }')];
  }
  if (last === "value") {
    return [ruleGroupError("invalid_type", path, "value 应为文本、文本数组、数字或布尔值")];
  }
  return [ruleGroupError("invalid_value", path, "取值不符合任何允许的形式")];
}

function pickBranch(branches: ZodIssue[][], value: unknown, path: RuleGroupIssuePath): ZodIssue[] | null {
  if (isPlainObject(value) && isCondPath(path)) {
    const index = COND_BRANCH_KEYS.findIndex((key) => key in value);
    if (index >= 0) return branches[index] ?? null;
  }
  if (isPlainObject(value) && path[path.length - 1] === "links") return branches[2] ?? null;
  // 其余情况：选不含"根上类型不对"错误、且错误最少的分支
  const candidates = branches.filter((issues) => issues.every((issue) => issue.path.length > 0));
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0] ?? null;
}

function isCondPath(path: RuleGroupIssuePath): boolean {
  const last = path[path.length - 1];
  const parent = path[path.length - 2];
  if (last === "when" || last === "not") return true;
  return typeof last === "number" && (parent === "all" || parent === "any");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAt(input: unknown, path: RuleGroupIssuePath): unknown {
  let current: unknown = input;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}
