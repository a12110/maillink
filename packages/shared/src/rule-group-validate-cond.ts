import {
  MAIL_CATEGORIES,
  RULE_FIELD_KINDS,
  RULE_OPS_BY_KIND,
  TEXT_OPS,
  type Cond,
  type CondLeaf,
  type Rule,
  type RuleField,
  type RuleGroupConfig,
  type RuleOp,
} from "./rule-group";
import {
  ruleGroupError,
  ruleGroupWarning,
  type RuleGroupIssue,
  type RuleGroupIssuePath,
} from "./rule-group-issues";
import { RULE_GROUP_LIMITS } from "./rule-group-limits";
import { isValidDomain, normalizeDomain, normalizeText } from "./rule-group-normalize";

// 过滤规则的语义校验：上限、字段与操作符匹配、取值类型、互斥约束（02 §3.2–§3.4、§7）。

/** 待统一检查（长度、编译、静态检查、试跑）的正则 */
export type RegexCandidate = {
  pattern: string;
  path: RuleGroupIssuePath;
  caseSensitive: boolean;
  global: boolean;
};

export type ValidationContext = {
  issues: RuleGroupIssue[];
  regexes: RegexCandidate[];
};

type RuleWalkState = { leaves: number; tooDeep: boolean; fields: Set<RuleField> };

const FIELD_KIND_ZH: Record<string, string> = {
  text: "文本",
  text_list: "文本列表",
  domain_list: "域名列表",
  bool: "布尔",
  enum: "枚举",
  number: "数字",
};

export function checkFilter(config: RuleGroupConfig, ctx: ValidationContext): void {
  const rules = config.filter.rules;
  const base: RuleGroupIssuePath = ["filter", "rules"];
  if (rules.length > RULE_GROUP_LIMITS.maxRules) {
    ctx.issues.push(
      ruleGroupError("too_many_rules", base, `规则数 ${rules.length} 超过上限 ${RULE_GROUP_LIMITS.maxRules}`),
    );
  }
  checkDuplicateIds(rules, base, ctx);
  const extractsLoginLink = config.present.extract.includes("login_link");
  let leaves = 0;
  rules.forEach((rule, index) => {
    leaves += checkRule(rule, [...base, index], extractsLoginLink, ctx);
  });
  if (leaves > RULE_GROUP_LIMITS.maxLeaves) {
    ctx.issues.push(
      ruleGroupError("too_many_leaves", base, `条件总数 ${leaves} 超过上限 ${RULE_GROUP_LIMITS.maxLeaves}（含停用的规则）`),
    );
  }
  checkMode(config, base, ctx);
}

function checkDuplicateIds(rules: Rule[], base: RuleGroupIssuePath, ctx: ValidationContext): void {
  const seen = new Set<string>();
  rules.forEach((rule, index) => {
    if (seen.has(rule.id)) {
      ctx.issues.push(ruleGroupError("duplicate_rule_id", [...base, index, "id"], `规则 id "${rule.id}" 重复`));
    }
    seen.add(rule.id);
  });
}

function checkMode(config: RuleGroupConfig, base: RuleGroupIssuePath, ctx: ValidationContext): void {
  const rules = config.filter.rules;
  if (config.filter.mode === "blacklist") {
    rules.forEach((rule, index) => {
      if (rule.effect !== "allow") return;
      ctx.issues.push(
        ruleGroupError(
          "blacklist_allow_rule",
          [...base, index, "effect"],
          `黑名单模式下不能有"允许"规则（规则"${rule.name}"）：黑名单默认全部可见，允许规则没有意义，也容易让人误以为生效了。请改成白名单模式或删除这条规则`,
        ),
      );
    });
    return;
  }
  if (!rules.some((rule) => rule.enabled && rule.effect === "allow")) {
    ctx.issues.push(
      ruleGroupWarning(
        "whitelist_no_enabled_allow",
        base,
        "白名单模式下没有启用的允许规则：所有邮件都不可见",
      ),
    );
  }
}

/** 返回该规则的叶子数 */
function checkRule(rule: Rule, path: RuleGroupIssuePath, extractsLoginLink: boolean, ctx: ValidationContext): number {
  const state: RuleWalkState = { leaves: 0, tooDeep: false, fields: new Set() };
  const whenPath = [...path, "when"];
  walkCond(rule.when, whenPath, 0, ctx, state);
  if (state.tooDeep) {
    ctx.issues.push(
      ruleGroupError("cond_too_deep", whenPath, `条件嵌套超过 ${RULE_GROUP_LIMITS.maxDepth} 层（all / any / not 各算一层）`),
    );
  }
  const fields = state.fields;
  const pinsSender = fields.has("sender.domain") || fields.has("sender.address");
  if (rule.effect === "allow" && fields.has("sender.name") && !pinsSender) {
    ctx.issues.push(
      ruleGroupWarning("sender_name_spoofable", whenPath, "发件人显示名可以随意伪造，不要单独用它做白名单；请同时限定发件人域名"),
    );
  }
  if (fields.has("login_link.present") && !extractsLoginLink) {
    ctx.issues.push(
      ruleGroupWarning(
        "login_link_not_extracted",
        whenPath,
        "用到了 login_link.present，但 present.extract 没有包含 login_link，该字段恒为 false",
      ),
    );
  }
  return state.leaves;
}

function walkCond(cond: Cond, path: RuleGroupIssuePath, depth: number, ctx: ValidationContext, state: RuleWalkState): void {
  if ("not" in cond) {
    markDepth(depth + 1, state);
    walkCond(cond.not, [...path, "not"], depth + 1, ctx, state);
    return;
  }
  if ("all" in cond || "any" in cond) {
    const key = "all" in cond ? "all" : "any";
    const children = "all" in cond ? cond.all : cond.any;
    markDepth(depth + 1, state);
    if (children.length === 0) {
      const meaning = key === "all" ? "空的 all 恒为真，会让规则命中所有邮件" : "空的 any 恒为假";
      ctx.issues.push(ruleGroupError("empty_condition_group", [...path, key], `${key} 里至少要有一个条件：${meaning}`));
    }
    children.forEach((child, index) => walkCond(child, [...path, key, index], depth + 1, ctx, state));
    return;
  }
  state.leaves += 1;
  state.fields.add(cond.field);
  checkLeaf(cond, path, ctx);
}

function markDepth(depth: number, state: RuleWalkState): void {
  if (depth > RULE_GROUP_LIMITS.maxDepth) state.tooDeep = true;
}

function checkLeaf(leaf: CondLeaf, path: RuleGroupIssuePath, ctx: ValidationContext): void {
  const kind = RULE_FIELD_KINDS[leaf.field];
  const allowedOps = RULE_OPS_BY_KIND[kind];
  if (!allowedOps.includes(leaf.op)) {
    ctx.issues.push(
      ruleGroupError(
        "op_not_supported_for_field",
        [...path, "op"],
        `字段 ${leaf.field}（${FIELD_KIND_ZH[kind]}）不支持操作符 ${leaf.op}，可用：${allowedOps.join("、")}`,
      ),
    );
    return;
  }
  if (leaf.case_sensitive !== undefined && !isTextOp(leaf.op)) {
    ctx.issues.push(
      ruleGroupError("case_sensitive_not_supported", [...path, "case_sensitive"], `操作符 ${leaf.op} 不支持区分大小写`),
    );
  }
  if (leaf.case_sensitive !== undefined && kind === "enum") {
    ctx.issues.push(
      ruleGroupWarning("case_sensitive_ignored", [...path, "case_sensitive"], "分类是固定的枚举值，case_sensitive 对它不起作用"),
    );
  }
  if (leaf.op === "ends_with" && kind === "domain_list") {
    ctx.issues.push(
      ruleGroupWarning(
        "ends_with_on_domain",
        [...path, "op"],
        '按域名后缀筛选请用 domain_is：ends_with "apple.com" 会把 fakeapple.com 也算进来',
      ),
    );
  }
  checkLeafValue(leaf, path, ctx);
}

function isTextOp(op: RuleOp): boolean {
  return (TEXT_OPS as readonly RuleOp[]).includes(op);
}

function checkLeafValue(leaf: CondLeaf, path: RuleGroupIssuePath, ctx: ValidationContext): void {
  const valuePath = [...path, "value"];
  if (leaf.op === "is") {
    if (typeof leaf.value !== "boolean") {
      ctx.issues.push(ruleGroupError("value_type_mismatch", valuePath, "操作符 is 的取值应为 true 或 false"));
    }
    return;
  }
  if (leaf.op === "gt" || leaf.op === "lt") {
    if (typeof leaf.value !== "number") {
      ctx.issues.push(ruleGroupError("value_type_mismatch", valuePath, `操作符 ${leaf.op} 的取值应为数字`));
    }
    return;
  }
  checkTextValues(leaf, valuePath, ctx);
}

function checkTextValues(leaf: CondLeaf, valuePath: RuleGroupIssuePath, ctx: ValidationContext): void {
  const { value } = leaf;
  if (typeof value !== "string" && !Array.isArray(value)) {
    ctx.issues.push(ruleGroupError("value_type_mismatch", valuePath, `操作符 ${leaf.op} 的取值应为文本或文本数组`));
    return;
  }
  const items = typeof value === "string" ? [value] : value;
  if (items.length === 0) {
    ctx.issues.push(ruleGroupError("empty_value", valuePath, "取值列表不能为空：空列表永远不会命中"));
    return;
  }
  if (items.length > RULE_GROUP_LIMITS.maxValueItems) {
    ctx.issues.push(
      ruleGroupError("value_list_too_long", valuePath, `取值列表 ${items.length} 项，超过上限 ${RULE_GROUP_LIMITS.maxValueItems}`),
    );
    return;
  }
  items.forEach((item, index) => {
    const itemPath = Array.isArray(value) ? [...valuePath, index] : valuePath;
    checkTextItem(leaf, item, itemPath, ctx);
  });
}

function checkTextItem(leaf: CondLeaf, item: string, path: RuleGroupIssuePath, ctx: ValidationContext): void {
  if (normalizeText(item) === "") {
    ctx.issues.push(ruleGroupError("empty_value", path, "取值不能为空（空文本会命中所有邮件）"));
    return;
  }
  if (leaf.op === "domain_is") {
    checkDomainItem(item, path, ctx);
    return;
  }
  if (RULE_FIELD_KINDS[leaf.field] === "enum" && !(MAIL_CATEGORIES as readonly string[]).includes(item)) {
    ctx.issues.push(
      ruleGroupError("invalid_category", path, `不认识的分类"${item}"，可选：${MAIL_CATEGORIES.join("、")}`),
    );
    return;
  }
  if (leaf.op === "regex") {
    ctx.regexes.push({ pattern: item, path, caseSensitive: leaf.case_sensitive === true, global: false });
  }
}

export function checkDomainItem(item: string, path: RuleGroupIssuePath, ctx: ValidationContext): void {
  const domain = normalizeDomain(item);
  if (isValidDomain(domain)) return;
  ctx.issues.push(
    ruleGroupError(
      "invalid_domain",
      path,
      `"${item}" 不是合法的域名：只填域名本身（如 apple.com），不带 @、协议、路径或通配符；domain_is 会自动覆盖子域名`,
    ),
  );
}
