import { RULE_GROUP_LIMITS } from "@maillink/shared";
import type { Redaction, RuleGroupConfig, RuleGroupIssue } from "@maillink/shared";
import { Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, Segmented, TextField } from "../../../ui";
import { issuesAt } from "../issues";
import { FieldIssues } from "./FieldIssues";

type Props = { config: RuleGroupConfig; issues: readonly RuleGroupIssue[]; onChange: (update: (c: RuleGroupConfig) => RuleGroupConfig) => void };

type Scope = Redaction["scope"][number];

const NEW_REDACTION: Redaction = { name: "新的脱敏规则", match: { type: "text", pattern: "" }, scope: ["subject", "body"], replace: "***" };

function RedactionCard({ item, index, issues, onChange, onRemove }: { item: Redaction; index: number; issues: readonly RuleGroupIssue[]; onChange: (next: Redaction) => void; onRemove: () => void }) {
  const base = ["present", "redact", index];
  const toggleScope = (scope: Scope, on: boolean) => onChange({ ...item, scope: on ? [...item.scope, scope] : item.scope.filter((s) => s !== scope) });
  return (
    <div className="redact-card">
      <div className="redact-head">
        <input className="rule-name" value={item.name} aria-label="脱敏规则名称" onChange={(event) => onChange({ ...item, name: event.target.value })} />
        <Button variant="ghost" size="sm" iconOnly aria-label={`删除脱敏规则 ${item.name}`} title="删除脱敏规则" onClick={onRemove}><Trash2 /></Button>
      </div>
      <div className="redact-grid">
        <Segmented legend="匹配方式" hideLegend size="sm" name={`redact-type-${index}`} value={item.match.type} options={[{ value: "text", label: "文本" }, { value: "regex", label: "正则" }]}
          onChange={(type) => onChange({ ...item, match: { ...item.match, type } })} />
        <TextField label="匹配内容" mono value={item.match.pattern} placeholder={item.match.type === "regex" ? "例如 1[3-9]\\d{9}" : "要替换的文字"}
          error={issuesAt(issues, [...base, "match"])[0]?.message} onChange={(event) => onChange({ ...item, match: { ...item.match, pattern: event.target.value } })} />
        <TextField label="替换为" mono value={item.replace} onChange={(event) => onChange({ ...item, replace: event.target.value })} />
      </div>
      <div className="row-inline" role="group" aria-label="作用范围">
        <span className="field-hint">作用于</span>
        <Checkbox checked={item.scope.includes("subject")} onChange={(event) => toggleScope("subject", event.target.checked)}>主题</Checkbox>
        <Checkbox checked={item.scope.includes("body")} onChange={(event) => toggleScope("body", event.target.checked)}>正文</Checkbox>
      </div>
      <FieldIssues issues={issuesAt(issues, [...base, "scope"]).concat(issuesAt(issues, [...base, "name"]), issuesAt(issues, [...base, "replace"]))} />
    </div>
  );
}

/** 脱敏规则：按列表依次替换，作用于主题、预览、正文（02 §4.4）。配置了脱敏就不能用“完整”视图 */
export function RedactSection({ config, issues, onChange }: Props) {
  const { redact } = config.present;
  const setRedact = (next: Redaction[]) => onChange((c) => ({ ...c, present: { ...c.present, redact: next } }));
  return (
    <div className="stack">
      <div className="redact-list">
        {redact.map((item, index) => (
          <RedactionCard key={index} item={item} index={index} issues={issues}
            onChange={(next) => setRedact(redact.map((r, i) => (i === index ? next : r)))} onRemove={() => setRedact(redact.filter((_, i) => i !== index))} />
        ))}
      </div>
      <div className="row-inline">
        <Button size="sm" onClick={() => setRedact([...redact, structuredClone(NEW_REDACTION)])}><Plus />添加脱敏规则</Button>
        <span className="field-hint">{redact.length} / {RULE_GROUP_LIMITS.maxRedactions} 条；配了脱敏就不能用“完整”视图。</span>
      </div>
      <FieldIssues issues={issuesAt(issues, ["present", "redact"]).filter((issue) => issue.path.length <= 3)} />
    </div>
  );
}
