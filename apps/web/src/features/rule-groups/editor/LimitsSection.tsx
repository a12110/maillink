import { RULE_GROUP_LIMITS } from "@maillink/shared";
import type { RuleGroupConfig, RuleGroupIssue } from "@maillink/shared";
import { issuesAt } from "../issues";
import { NumberField } from "./NumberField";

type Props = { config: RuleGroupConfig; issues: readonly RuleGroupIssue[]; onChange: (update: (c: RuleGroupConfig) => RuleGroupConfig) => void };

/** ④ 数量上限：过滤之后只保留最新的 N 封，没有分页 */
export function LimitsSection({ config, issues, onChange }: Props) {
  return (
    <section aria-labelledby="s-limit">
      <h2 className="section-title" id="s-limit"><span className="idx">4</span>数量上限</h2>
      <p className="section-lead">过滤之后只保留最新的几封，没有分页。</p>
      <div className="limit-field">
        <NumberField label="最多显示" suffix="封" placeholder="不限制" value={config.limits.max_mails}
          error={issuesAt(issues, ["limits"])[0]?.message}
          hint={`不填 = 不限制；上限 ${RULE_GROUP_LIMITS.maxMailsCap}。连点几次“重新发送”时能看到最新几封，又不会变成历史记录。`}
          onChange={(max) => onChange((c) => ({ ...c, limits: max === undefined ? {} : { max_mails: max } }))} />
      </div>
    </section>
  );
}
