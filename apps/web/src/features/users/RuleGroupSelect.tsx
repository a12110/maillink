import { useQuery } from "@tanstack/react-query";
import { ruleGroupPickerQuery } from "../../api/queries-auth";
import { describeError } from "../../lib/messages";
import { ErrorCallout, Select } from "../../ui";

const FULL_ACCESS = "full";

type Props = { value: number | null; onChange: (value: number | null) => void; idPrefix: string };

/** 规则组选择：第一项是“完整访问”（rule_group_id = null：黑名单、无规则、full 视图）；配置无效的规则组不可选（授权会被后端拒绝） */
export function RuleGroupSelect({ value, onChange, idPrefix }: Props) {
  const list = useQuery(ruleGroupPickerQuery());
  return (
    <div className="field">
      <label className="field-label" htmlFor={`${idPrefix}-rule-group`}>规则组</label>
      <Select block id={`${idPrefix}-rule-group`} value={value === null ? FULL_ACCESS : String(value)}
        onChange={(event) => onChange(event.target.value === FULL_ACCESS ? null : Number(event.target.value))}>
        <option value={FULL_ACCESS}>完整访问（不限制，看到全部邮件与完整内容）</option>
        {list.data?.items.map((group) => (
          <option key={group.id} value={group.id} disabled={group.invalid}>
            {group.name}{group.invalid ? "（配置无效）" : ""}
          </option>
        ))}
      </Select>
      {list.isError ? <ErrorCallout title="规则组加载失败" {...describeError(list.error)} onRetry={() => void list.refetch()} /> : null}
      <p className="field-hint">规则组决定该用户能看到哪些邮件、显示多少内容；改规则组后立即生效。</p>
    </div>
  );
}
