import { PLATFORM_PRESETS, RULE_FIELD_KINDS } from "@maillink/shared";
import type { CondLeaf, RuleGroupIssue } from "@maillink/shared";
import { ChipInput, Select } from "../../../ui";
import { itemsToValue, valueItems } from "../config";
import { CATEGORY_NAME, CATEGORY_OPTIONS } from "../labels";
import { issuesAt } from "../issues";
import { NumberField } from "./NumberField";

type Props = {
  leaf: CondLeaf;
  /** 这一行的问题（path 以 [...ruleRow, "value"] 开头的会标到对应的标签上） */
  issues: readonly RuleGroupIssue[];
  /** 这一行 `value` 的路径，用来把 issue 对到某个标签 */
  valuePath: ReadonlyArray<string | number>;
  onChange: (leaf: CondLeaf) => void;
};

function BoolValue({ leaf, onChange }: Pick<Props, "leaf" | "onChange">) {
  return (
    <Select block aria-label="取值" value={leaf.value === false ? "false" : "true"} onChange={(event) => onChange({ ...leaf, value: event.target.value === "true" })}>
      <option value="true">是</option>
      <option value="false">否</option>
    </Select>
  );
}

function CategoryValue({ leaf, onChange }: Pick<Props, "leaf" | "onChange">) {
  const picked = valueItems(leaf.value);
  const toggle = (category: string, on: boolean) => {
    const items = on ? [...picked, category] : picked.filter((item) => item !== category);
    onChange({ ...leaf, value: itemsToValue(items, leaf.value) });
  };
  return (
    <div className="category-picker" role="group" aria-label="邮件分类（可多选，命中任一即可）">
      {CATEGORY_OPTIONS.map((category) => (
        <label key={category} className="pill" title={category}>
          <input type="checkbox" checked={picked.includes(category)} aria-label={`${CATEGORY_NAME[category]}（${category}）`} onChange={(event) => toggle(category, event.target.checked)} />
          <span>{CATEGORY_NAME[category]}</span>
        </label>
      ))}
    </div>
  );
}

const PLACEHOLDER: Record<string, string> = {
  domain_is: "openai.com，按 Enter 添加",
  regex: "正则表达式，按 Enter 添加",
};

function TextValue({ leaf, issues, valuePath, onChange }: Props) {
  const items = valueItems(leaf.value);
  const arrayValue = Array.isArray(leaf.value);
  const itemError = (_value: string, index: number) =>
    issuesAt(issues, arrayValue ? [...valuePath, index] : valuePath).find((issue) => issue.severity === "error")?.message;
  const invalid = issuesAt(issues, [...valuePath]).some((issue) => issue.severity === "error");
  return (
    <ChipInput
      values={items}
      onChange={(next) => onChange({ ...leaf, value: itemsToValue(next, leaf.value) })}
      aria-label="取值（多个值命中任一即可）"
      placeholder={PLACEHOLDER[leaf.op] ?? "输入后按 Enter 添加；多个值命中任一即可"}
      splitOnComma={leaf.op !== "regex"}
      invalid={invalid}
      itemError={itemError}
    />
  );
}

/** 平台预设：把该平台的发件人域名一键追加进取值（预设是凭常识填的，没有用真实邮件核对过） */
export function PresetPicker({ leaf, onChange }: Pick<Props, "leaf" | "onChange">) {
  const add = (key: string) => {
    const preset = PLATFORM_PRESETS.find((candidate) => candidate.key === key);
    if (!preset) return;
    const have = new Set(valueItems(leaf.value).map((item) => item.toLowerCase()));
    const merged = [...valueItems(leaf.value), ...preset.sender_domains.filter((domain) => !have.has(domain))];
    onChange({ ...leaf, value: itemsToValue(merged, leaf.value) });
  };
  return (
    <Select aria-label="平台预设：填入发件人域名" value="" onChange={(event) => add(event.target.value)}>
      <option value="">填入平台预设…</option>
      {PLATFORM_PRESETS.map((preset) => (
        <option key={preset.key} value={preset.key}>{preset.name}（{preset.sender_domains.join("、")}）</option>
      ))}
    </Select>
  );
}

export function ValueEditor(props: Props) {
  const { leaf, onChange } = props;
  const kind = RULE_FIELD_KINDS[leaf.field];
  if (kind === "bool") return <BoolValue leaf={leaf} onChange={onChange} />;
  if (kind === "enum") return <CategoryValue leaf={leaf} onChange={onChange} />;
  if (kind === "number") {
    return (
      <NumberField label="取值" hideLabel value={typeof leaf.value === "number" ? leaf.value : undefined} placeholder="0"
        onChange={(value) => onChange({ ...leaf, value: value ?? 0 })} />
    );
  }
  return <TextValue {...props} />;
}
