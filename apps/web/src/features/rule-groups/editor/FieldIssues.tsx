import { CircleAlert, TriangleAlert } from "lucide-react";
import type { RuleGroupIssue } from "@maillink/shared";

/** 就地显示字段的校验问题：错误红、警告赭；图标 + 文字，不靠颜色单独表达 */
export function FieldIssues({ issues, id }: { issues: readonly RuleGroupIssue[]; id?: string }) {
  if (issues.length === 0) return null;
  return (
    <ul className="field-issues" id={id}>
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} data-severity={issue.severity}>
          {issue.severity === "error" ? <CircleAlert className="icon-sm" aria-label="错误" /> : <TriangleAlert className="icon-sm" aria-label="提示" />}
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}
