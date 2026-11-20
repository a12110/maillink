import { formatIssuePath } from "@maillink/shared";
import type { RuleGroupIssue } from "@maillink/shared";
import { Callout } from "../../../ui";
import { errorsOf, warningsOf } from "../issues";

/** 顶部清单：所有问题都列在这里（字段旁的是就地提示，这里是兜底，保证没有控件的问题也看得见） */
export function IssueSummary({ issues }: { issues: readonly RuleGroupIssue[] }) {
  const errors = errorsOf(issues);
  const warnings = warningsOf(issues);
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <Callout tone={errors.length > 0 ? "danger" : "warning"}
      title={errors.length > 0 ? `${errors.length} 个错误需要先解决才能保存${warnings.length > 0 ? `，另有 ${warnings.length} 条提醒` : ""}` : `${warnings.length} 条提醒（不阻止保存）`}
      actions={
        <details className="issue-summary">
          <summary>查看全部</summary>
          <ul>
            {[...errors, ...warnings].map((issue, index) => (
              <li key={index} data-severity={issue.severity}>
                <code>{formatIssuePath(issue.path) || "整份配置"}</code> {issue.message}
              </li>
            ))}
          </ul>
        </details>
      } />
  );
}
