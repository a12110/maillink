import { RULE_GROUP_LIMITS } from "@maillink/shared";
import type { Rule, RuleGroupConfig, RuleGroupIssue } from "@maillink/shared";
import { Plus } from "lucide-react";
import { Button, Callout, Segmented } from "../../../ui";
import { newRule } from "../config";
import { issuesAt, issuesExactlyAt } from "../issues";
import { FieldIssues } from "./FieldIssues";
import { RuleCard } from "./RuleCard";

type Mode = RuleGroupConfig["filter"]["mode"];

const MODE_OPTIONS: ReadonlyArray<{ value: Mode; label: string }> = [
  { value: "whitelist", label: "白名单" },
  { value: "blacklist", label: "黑名单" },
];

const MODE_HINT: Record<Mode, string> = {
  whitelist: "白名单：只有命中某条“允许”规则的邮件可见。",
  blacklist: "黑名单：默认全部可见，命中“屏蔽”规则的不可见（黑名单里不能有“允许”规则）。",
};

type Props = {
  config: RuleGroupConfig;
  issues: readonly RuleGroupIssue[];
  onChange: (update: (c: RuleGroupConfig) => RuleGroupConfig) => void;
  onOpenJson: () => void;
};

/** 02 §9 的安全提醒：写进编辑器，不靠文档 */
function SecurityReminder() {
  return (
    <Callout tone="info" title="把收件地址分享出去，等于对方可能收到这个地址的密码重置邮件">
      对外分发的规则组建议至少满足其一：用“仅验证码”视图；白名单里限定发件人；屏蔽改密类关键词并隐藏链接。本页的规则只决定“看得到什么”，不会替你判断是否安全。
    </Callout>
  );
}

function setRules(config: RuleGroupConfig, rules: Rule[]): RuleGroupConfig {
  return { ...config, filter: { ...config.filter, rules } };
}

/** ② 过滤：模式切换 + 规则卡片列表（02 §3.2）。更深的嵌套走 JSON 模式 */
export function FilterSection({ config, issues, onChange, onOpenJson }: Props) {
  const { mode, rules } = config.filter;
  const update = (index: number, rule: Rule) => onChange((c) => setRules(c, c.filter.rules.map((r, i) => (i === index ? rule : r))));
  const sectionIssues = [...issuesAt(issues, ["filter", "mode"]), ...issuesExactlyAt(issues, ["filter", "rules"])];
  return (
    <section aria-labelledby="s-filter">
      <h2 className="section-title" id="s-filter"><span className="idx">2</span>过滤</h2>
      <p className="section-lead">决定哪些邮件“能不能被看到”。任一启用的屏蔽规则命中就不可见，与规则顺序无关。</p>
      <div className="editor-gap">
        <Segmented legend="模式" name="filter-mode" value={mode} options={MODE_OPTIONS} hint={MODE_HINT[mode]}
          onChange={(next) => onChange((c) => ({ ...c, filter: { ...c.filter, mode: next } }))} />
      </div>
      <FieldIssues issues={sectionIssues} />
      <div className="rule-list">
        {rules.map((rule, index) => (
          <RuleCard key={rule.id} rule={rule} index={index} mode={mode} issues={issues} onOpenJson={onOpenJson}
            onChange={(next) => update(index, next)}
            onRemove={() => onChange((c) => setRules(c, c.filter.rules.filter((_, i) => i !== index)))}
            onDuplicate={() => onChange((c) => setRules(c, [...c.filter.rules, { ...structuredClone(rule), id: newRule(c.filter.rules, rule.effect).id, name: `${rule.name}（副本）` }]))} />
        ))}
      </div>
      <div className="rule-add">
        {mode === "whitelist" ? (
          <Button size="sm" onClick={() => onChange((c) => setRules(c, [...c.filter.rules, newRule(c.filter.rules, "allow")]))}><Plus />添加允许规则</Button>
        ) : null}
        <Button size="sm" onClick={() => onChange((c) => setRules(c, [...c.filter.rules, newRule(c.filter.rules, "deny")]))}><Plus />添加屏蔽规则</Button>
        <span className="field-hint">{rules.length} / {RULE_GROUP_LIMITS.maxRules} 条</span>
      </div>
      <div className="editor-gap"><SecurityReminder /></div>
      <p className="field-hint">正则只有管理员能写；保存时服务端还会在样本上试跑计时，过慢的正则会被拒绝。</p>
    </section>
  );
}
