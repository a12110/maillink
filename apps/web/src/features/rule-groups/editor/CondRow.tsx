import { RULE_FIELD_KINDS, RULE_OPS_BY_KIND } from "@maillink/shared";
import type { CondLeaf, RuleField, RuleGroupIssue, RuleOp } from "@maillink/shared";
import { X } from "lucide-react";
import { Button, Checkbox, Select } from "../../../ui";
import { changeLeafField, changeLeafOp, supportsCaseSensitive } from "../config";
import { FIELD_LABEL, FIELD_ORDER, OP_LABEL } from "../labels";
import { FieldIssues } from "./FieldIssues";
import { PresetPicker, ValueEditor } from "./ValueEditor";

type Props = {
  leaf: CondLeaf;
  index: number;
  /** 这一行 value 在配置里的路径 */
  valuePath: ReadonlyArray<string | number>;
  issues: readonly RuleGroupIssue[];
  /** 是否还能删（单个叶子也能删：删掉最后一个条件会得到“空 all”，由校验说明） */
  onChange: (leaf: CondLeaf) => void;
  onRemove: () => void;
};

/** 域名字段上选“结尾是”的风险（02 §3.4）；校验也会给同样的警告，这里是选的当下就写在旁边 */
const ENDS_WITH_RISK = "“结尾是”会把 fakeapple.com 也放进来；按发件人后缀过滤请用“是该域名或子域名”。";

function opLabel(op: RuleOp, field: RuleField): string {
  return isDomainEndsWith({ field, op, value: [] }) ? `${OP_LABEL[op]}（有风险）` : OP_LABEL[op];
}

const isDomainEndsWith = (leaf: CondLeaf) => leaf.op === "ends_with" && RULE_FIELD_KINDS[leaf.field] === "domain_list";

function RowExtras({ leaf, onChange }: Pick<Props, "leaf" | "onChange">) {
  const showPreset = leaf.field === "sender.domain" && (leaf.op === "domain_is" || leaf.op === "eq");
  const endsWithRisk = isDomainEndsWith(leaf);
  if (!showPreset && !supportsCaseSensitive(leaf) && !endsWithRisk) return null;
  return (
    <div className="cond-extras">
      {endsWithRisk ? <p className="field-hint">{ENDS_WITH_RISK}</p> : null}
      {showPreset ? <PresetPicker leaf={leaf} onChange={onChange} /> : null}
      {supportsCaseSensitive(leaf) ? (
        <Checkbox checked={leaf.case_sensitive === true} onChange={(event) => onChange({ ...leaf, case_sensitive: event.target.checked ? true : undefined })}>
          区分大小写
        </Checkbox>
      ) : null}
    </div>
  );
}

/** 一行条件：字段 / 操作符 / 取值 / 删除；问题就地显示在这一行下面 */
export function CondRow({ leaf, index, valuePath, issues, onChange, onRemove }: Props) {
  const kind = RULE_FIELD_KINDS[leaf.field];
  return (
    <div className="cond-block">
      <div className="cond" data-kind={kind}>
        <Select block aria-label="字段" value={leaf.field} onChange={(event) => onChange(changeLeafField(leaf, event.target.value as RuleField))}>
          {FIELD_ORDER.map((field) => <option key={field} value={field}>{FIELD_LABEL[field]}</option>)}
        </Select>
        {kind === "bool" ? null : (
          <Select block aria-label="操作符" value={leaf.op} onChange={(event) => onChange(changeLeafOp(leaf, event.target.value as RuleOp))}>
            {RULE_OPS_BY_KIND[kind].map((op) => <option key={op} value={op}>{opLabel(op, leaf.field)}</option>)}
          </Select>
        )}
        <ValueEditor leaf={leaf} issues={issues} valuePath={valuePath} onChange={onChange} />
        <Button variant="ghost" size="sm" iconOnly aria-label={`删除第 ${index + 1} 个条件`} title="删除条件" onClick={onRemove}>
          <X />
        </Button>
      </div>
      <RowExtras leaf={leaf} onChange={onChange} />
      <FieldIssues issues={issues} />
    </div>
  );
}
