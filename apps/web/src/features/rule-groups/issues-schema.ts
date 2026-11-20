import { RULE_GROUP_ISSUE_CODES } from "@maillink/shared";
import type { RuleGroupIssue } from "@maillink/shared";
import { z } from "zod";

const issueSchema = z.object({
  code: z.enum(RULE_GROUP_ISSUE_CODES),
  severity: z.enum(["error", "warning"]),
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

/** 错误体里的 issues 数组 → 类型化的问题列表；不是预期形状返回 null */
export function parseIssueList(value: unknown): RuleGroupIssue[] | null {
  const parsed = z.array(issueSchema).safeParse(value ?? []);
  return parsed.success ? parsed.data : null;
}
