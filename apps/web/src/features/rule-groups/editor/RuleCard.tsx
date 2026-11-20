import { useId, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { RULE_GROUP_LIMITS } from "@maillink/shared";
import type { CondLeaf, Rule, RuleGroupIssue } from "@maillink/shared";
import { Button, Callout, Segmented, Switch } from "../../../ui";
import { buildWhen, describeFlat, flattenWhen, newLeaf } from "../config";
import type { FlatCond, MatchMode } from "../config";
import { issuesAt, splitRuleIssues } from "../issues";
import { CondRow } from "./CondRow";
import { FieldIssues } from "./FieldIssues";

export type RuleCardProps = {
  rule: Rule;
  index: number;
  mode: "whitelist" | "blacklist";
  issues: readonly RuleGroupIssue[];
  onChange: (rule: Rule) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onOpenJson: () => void;
};

const EFFECT_OPTIONS = [
  { value: "allow", label: "允许" },
  { value: "deny", label: "屏蔽" },
] as const;

const MATCH_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "any", label: "任一" },
] as const;

/** 条件改动后重建 when：原本是单个叶子、数量与匹配方式没变时保持单叶子形状 */
function rebuild(flat: FlatCond, leaves: CondLeaf[], match: MatchMode) {
  if (flat.shape === "leaf" && leaves.length === 1 && match === "all") return leaves[0] as CondLeaf;
  return buildWhen(match, leaves);
}

function RuleHead({ rule, mode, onChange, onRemove, onDuplicate }: RuleCardProps) {
  const reasonId = useId();
  const [explain, setExplain] = useState(false);
  const options = EFFECT_OPTIONS.map((option) => ({ ...option, locked: option.value === "allow" && mode === "blacklist" && rule.effect !== "allow" }));
  return (
    <>
      <div className="rule-head" data-collapsed={!rule.enabled}>
        <Switch aria-label="启用此规则" checked={rule.enabled} onChange={(event) => onChange({ ...rule, enabled: event.target.checked })} />
        <input className="rule-name" value={rule.name} aria-label="规则名称" maxLength={RULE_GROUP_LIMITS.maxNameLength} onChange={(event) => onChange({ ...rule, name: event.target.value })} />
        {!rule.enabled ? <span className="tag">已停用</span> : null}
        <Segmented legend="命中后" hideLegend size="sm" name={`effect-${rule.id}`} value={rule.effect} options={options}
          lockedReasonId={reasonId} onChange={(effect) => onChange({ ...rule, effect })} onLockedSelect={() => setExplain(true)} />
        <Button variant="ghost" size="sm" iconOnly aria-label={`复制规则 ${rule.name}`} title="复制规则" onClick={onDuplicate}><Copy /></Button>
        <Button variant="ghost" size="sm" iconOnly aria-label={`删除规则 ${rule.name}`} title="删除规则" onClick={onRemove}><Trash2 /></Button>
      </div>
      {explain && mode === "blacklist" ? (
        <div id={reasonId}>
          <Callout tone="warning" title="黑名单模式下不能选“允许”">
            黑名单默认全部可见，只有“屏蔽”规则有意义，允许规则没有作用也容易被误以为生效。要写允许规则，请先把过滤模式改成白名单。
          </Callout>
        </div>
      ) : null}
    </>
  );
}

function NestedNote({ rule, onOpenJson }: Pick<RuleCardProps, "rule" | "onOpenJson">) {
  return (
    <Callout tone="info" title="这条规则含嵌套条件（not 或多层 all / any）" actions={<button type="button" className="text-action" onClick={onOpenJson}>用 JSON 编辑</button>}>
      表单只编辑“全部 / 任一 + 若干条件”这一层；更深的嵌套请切到 JSON 模式，其余内容保持原样。
      <code className="nested-json">{JSON.stringify(rule.when)}</code>
    </Callout>
  );
}

type BodyProps = { flat: FlatCond; rule: Rule; rowIssues: RuleGroupIssue[][]; rulePath: ReadonlyArray<string | number>; onChange: (rule: Rule) => void };

function RuleBody({ flat, rule, rowIssues, rulePath, onChange }: BodyProps) {
  const setWhen = (leaves: CondLeaf[], match: MatchMode = flat.match) => onChange({ ...rule, when: rebuild(flat, leaves, match) });
  const leafValuePath = (j: number) => (flat.shape === "leaf" ? [...rulePath, "when", "value"] : [...rulePath, "when", flat.match, j, "value"]);
  return (
    <>
      <div className="match-row">
        满足下面
        <Segmented legend="满足方式" hideLegend size="sm" name={`match-${rule.id}`} value={flat.match} options={MATCH_OPTIONS}
          onChange={(match) => onChange({ ...rule, when: buildWhen(match, flat.leaves) })} />
        条件时命中
      </div>
      {flat.leaves.map((leaf, j) => (
        <CondRow key={j} leaf={leaf} index={j} valuePath={leafValuePath(j)} issues={rowIssues[j] ?? []}
          onChange={(next) => setWhen(flat.leaves.map((existing, k) => (k === j ? next : existing)))}
          onRemove={() => setWhen(flat.leaves.filter((_, k) => k !== j))} />
      ))}
      <Button size="sm" variant="ghost" onClick={() => setWhen([...flat.leaves, newLeaf()])}><Plus />添加条件</Button>
    </>
  );
}

/** 规则卡片：名称 + 启用开关 + 允许/屏蔽 + 条件行（全部 / 任一）。停用的规则折叠成一行摘要 */
export function RuleCard(props: RuleCardProps) {
  const { rule, index, issues, onChange, onOpenJson } = props;
  const rulePath = ["filter", "rules", index];
  const flat = flattenWhen(rule.when);
  const mine = issuesAt(issues, rulePath);
  const split = splitRuleIssues(mine, rulePath, flat ? flat.shape : "nested", flat?.leaves.length ?? 0);
  return (
    <article className="rule-card" data-effect={rule.effect} data-enabled={rule.enabled} aria-label={`规则：${rule.name}${rule.enabled ? "" : "（已停用）"}`}>
      <RuleHead {...props} />
      {!rule.enabled ? (
        <>
          <p className="field-hint">{describeFlat(rule, flat)}</p>
          <FieldIssues issues={mine} />
        </>
      ) : (
        <>
          {flat ? <RuleBody flat={flat} rule={rule} rowIssues={split.rows} rulePath={rulePath} onChange={onChange} /> : <NestedNote rule={rule} onOpenJson={onOpenJson} />}
          <FieldIssues issues={split.card} />
        </>
      )}
    </article>
  );
}
