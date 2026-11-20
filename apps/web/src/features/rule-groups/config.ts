import {
  RULE_FIELD_KINDS,
  RULE_GROUP_SCHEMA_VERSION,
  RULE_OPS_BY_KIND,
  ruleGroupConfigSchema,
  builtinRuleGroupTemplates,
} from "@maillink/shared";
import type { Cond, CondLeaf, CondValue, Rule, RuleField, RuleGroupConfig, RuleOp } from "@maillink/shared";
import type { RuleDraft } from "../../api/rule-draft";
import { describeLeaf } from "./labels";

// 规则组编辑器的配置工具：纯函数，不依赖 React。表单与 JSON 模式共用同一份配置对象，
// 所以“表单 ↔ JSON”不需要转换，往返不会丢字段；表单只对能表示的形状提供控件，其余原样保留。

/** 新建时的“空白”：白名单且没有规则 = 什么都看不到（失败关闭），保存前必须自己加允许规则 */
export const BLANK_CONFIG: RuleGroupConfig = {
  schema_version: RULE_GROUP_SCHEMA_VERSION,
  time: { since: { type: "none" } },
  filter: { mode: "whitelist", rules: [] },
  present: {
    view: "text",
    sender: "full",
    recipient: "masked",
    snippet: false,
    links: "strip",
    remote_images: "block",
    attachments: "hidden",
    redact: [],
    extract: ["code"],
  },
  limits: {},
};

/** 结构合法才能进表单模式；返回补齐默认值后的配置（如 extract 缺省为 ['code']） */
export function asFormConfig(value: unknown): RuleGroupConfig | null {
  const parsed = ruleGroupConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type TemplateChoice = { key: string; name: string; description: string };

export function templateChoices(): TemplateChoice[] {
  return builtinRuleGroupTemplates().map(({ key, name, description }) => ({ key, name, description }));
}

export function templateConfig(key: string): { name: string; description: string; config: RuleGroupConfig } | null {
  const template = builtinRuleGroupTemplates().find((candidate) => candidate.key === key);
  if (!template) return null;
  const config = asFormConfig(template.config);
  if (!config) throw new Error(`内置模板 ${key} 不符合规则组 schema`);
  return { name: template.name, description: template.description, config };
}

/**
 * “以此邮件创建规则”的草稿 → 初始配置：以「仅验证码」模板为底，把它的“含验证码”允许规则换成草稿规则
 *（屏蔽改密 / 高危分类的规则保留），验证码正则写进 present.code_regex。
 */
export function configFromDraft(draft: RuleDraft): { name: string; config: RuleGroupConfig } | null {
  const base = templateConfig("code_only");
  if (!base || draft.rule === null) return null;
  const denies = base.config.filter.rules.filter((rule) => rule.effect === "deny");
  const present = { ...base.config.present, ...(draft.code_regex === null ? {} : { code_regex: draft.code_regex }) };
  const config: RuleGroupConfig = { ...base.config, filter: { mode: "whitelist", rules: [draft.rule, ...denies] }, present };
  return { name: draft.rule.name, config };
}

// ── 条件 ──

export type MatchMode = "all" | "any";

/** 表单能直接编辑的条件形状：单个叶子，或 all / any 下全是叶子 */
export type FlatCond = { shape: "leaf" | "group"; match: MatchMode; leaves: CondLeaf[] };

export function isLeaf(cond: Cond): cond is CondLeaf {
  return "field" in cond;
}

export function flattenWhen(when: Cond): FlatCond | null {
  if (isLeaf(when)) return { shape: "leaf", match: "all", leaves: [when] };
  if ("not" in when) return null;
  const match: MatchMode = "all" in when ? "all" : "any";
  const children = "all" in when ? when.all : when.any;
  return children.every(isLeaf) ? { shape: "group", match, leaves: children as CondLeaf[] } : null;
}

export function buildWhen(match: MatchMode, leaves: readonly CondLeaf[]): Cond {
  return match === "all" ? { all: [...leaves] } : { any: [...leaves] };
}

export function defaultOp(field: RuleField): RuleOp {
  const kind = RULE_FIELD_KINDS[field];
  if (kind === "domain_list") return "domain_is";
  return RULE_OPS_BY_KIND[kind][0] ?? "eq";
}

function defaultValue(field: RuleField): CondValue {
  const kind = RULE_FIELD_KINDS[field];
  if (kind === "bool") return true;
  if (kind === "number") return 0;
  return [];
}

export function newLeaf(field: RuleField = "sender.domain"): CondLeaf {
  return { field, op: defaultOp(field), value: defaultValue(field) };
}

/** 换字段：同类型保留操作符与取值，跨类型重置（类型不同，旧值没有意义） */
export function changeLeafField(leaf: CondLeaf, field: RuleField): CondLeaf {
  if (RULE_FIELD_KINDS[field] === RULE_FIELD_KINDS[leaf.field]) return { ...leaf, field };
  return newLeaf(field);
}

/** 换操作符：取值类型随之变化时重置；case_sensitive 只对文本类操作符有意义，换走时去掉 */
export function changeLeafOp(leaf: CondLeaf, op: RuleOp): CondLeaf {
  const { case_sensitive: _dropped, ...rest } = leaf;
  const keepCase = leaf.case_sensitive !== undefined && TEXT_LIKE.has(op) ? { case_sensitive: leaf.case_sensitive } : {};
  return { ...rest, ...keepCase, op };
}
const TEXT_LIKE: ReadonlySet<RuleOp> = new Set(["eq", "contains", "starts_with", "ends_with", "regex"]);

export function supportsCaseSensitive(leaf: CondLeaf): boolean {
  return RULE_FIELD_KINDS[leaf.field] !== "enum" && TEXT_LIKE.has(leaf.op);
}

/** 文本取值 → 标签列表（单个字符串当作一项，非文本取值当作空） */
export function valueItems(value: CondValue): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value : [];
}

/** 标签列表 → 取值：原本是单个字符串且编辑后还是一项，保持字符串，避免无谓地改变存储形状 */
export function itemsToValue(items: string[], previous: CondValue): CondValue {
  return items.length === 1 && typeof previous === "string" ? (items[0] as string) : items;
}

export function nextRuleId(rules: readonly Rule[]): string {
  const taken = new Set(rules.map((rule) => rule.id));
  for (let n = rules.length + 1; ; n += 1) {
    if (!taken.has(`r${n}`)) return `r${n}`;
  }
}

export function newRule(rules: readonly Rule[], effect: Rule["effect"]): Rule {
  return { id: nextRuleId(rules), name: effect === "allow" ? "新的允许规则" : "新的屏蔽规则", enabled: true, effect, when: { all: [newLeaf()] } };
}

/** 停用规则折叠后的一行摘要：`屏蔽 · 主题 + 正文 包含 更换邮箱、change your email` */
export function describeFlat(rule: Rule, flat: FlatCond | null): string {
  const effect = rule.effect === "allow" ? "允许" : "屏蔽";
  if (flat === null) return `${effect} · 含嵌套条件（用 JSON 编辑）`;
  if (flat.leaves.length === 0) return `${effect} · 没有条件`;
  const joiner = flat.match === "all" ? "；且 " : "；或 ";
  return `${effect} · ${flat.leaves.map(describeLeaf).join(joiner)}`;
}

// ── 比较与“N 处未保存” ──

type Flat = Map<string, string>;

const hasId = (item: unknown): item is { id: unknown } => typeof item === "object" && item !== null && "id" in item;

/** 把配置压平成 路径 → 值；一条规则算一处（按 id 而不是下标定位，删掉中间一条不会让后面的全算成改动） */
function flatten(value: unknown, path: string, out: Flat): void {
  if (Array.isArray(value) && value.every(hasId)) {
    for (const item of value) out.set(`${path}[${String(item.id)}]`, JSON.stringify(item));
    return;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, path === "" ? key : `${path}.${key}`, out);
    return;
  }
  out.set(path, JSON.stringify(value));
}

export function countChanges(before: unknown, after: unknown): number {
  const a: Flat = new Map();
  const b: Flat = new Map();
  flatten(before, "", a);
  flatten(after, "", b);
  let changes = 0;
  for (const [key, value] of b) if (a.get(key) !== value) changes += 1;
  for (const key of a.keys()) if (!b.has(key)) changes += 1;
  return changes;
}

// ── 呈现的互斥约束（02 §4.4）──

/** 当前配置为什么不能选“完整”视图：脱敏规则、链接处理都要求纯文本或更严格的视图 */
export function fullViewBlockers(config: RuleGroupConfig): string[] {
  const reasons: string[] = [];
  if (config.present.redact.length > 0) reasons.push(`配置了 ${config.present.redact.length} 条脱敏规则`);
  if (config.present.links === "strip") reasons.push("链接设成了“全部移除”");
  else if (config.present.links !== "keep") reasons.push("链接设成了“只保留指定域名”");
  return reasons;
}

/** 登录链接只从 allow_domains 里的域名取，所以必须先限定域名才能勾选 */
export function canExtractLoginLink(config: RuleGroupConfig): boolean {
  const { links } = config.present;
  return typeof links === "object" && links.allow_domains.length > 0;
}
