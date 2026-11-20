import type { RuleGroupIssue } from "@maillink/shared";
import { formatIssuePath } from "@maillink/shared";
import { TextAreaField } from "../../../ui";

type Props = { text: string; parseError: string | null; issues: readonly RuleGroupIssue[]; onChange: (text: string) => void };

/** JSON 模式：整份配置的文本。语法错误时保留上一份合法配置（测试器与校验继续用它），并就地说明 */
export function JsonEditor({ text, parseError, issues, onChange }: Props) {
  return (
    <section aria-label="配置 JSON">
      <p className="section-lead">直接编辑整份配置（不含名称与说明）。适合 not、多层嵌套这类表单没有控件的写法；切回表单时其余内容保持原样。</p>
      <TextAreaField label="配置 JSON" hideLabel mono rows={28} spellCheck={false} value={text} error={parseError ?? undefined} onChange={(event) => onChange(event.target.value)} />
      {parseError ? <p className="field-hint">当前生效的仍是上一次能解析的配置，修好语法后才会更新。</p> : null}
      {issues.length > 0 ? (
        <ul className="field-issues json-issues" aria-label="配置问题">
          {issues.map((issue, index) => (
            <li key={index} data-severity={issue.severity}>
              <code>{formatIssuePath(issue.path) || "（整份配置）"}</code>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
