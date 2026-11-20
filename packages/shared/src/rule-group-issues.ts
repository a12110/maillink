// 规则组校验问题（错误与警告）的类型，供编辑器"当场说明原因"（05 §规则组编辑）。

export const RULE_GROUP_ISSUE_CODES = [
  // 结构
  "required",
  "invalid_type",
  "invalid_value",
  "unknown_field",
  "out_of_range",
  "invalid_condition",
  "unsupported_schema_version",
  // 上限（02 §7 及补充项）
  "too_many_rules",
  "too_many_leaves",
  "cond_too_deep",
  "value_list_too_long",
  "too_many_redactions",
  "too_many_regex",
  "regex_too_long",
  // 条件语义
  "empty_condition_group",
  "empty_value",
  "duplicate_rule_id",
  "op_not_supported_for_field",
  "value_type_mismatch",
  "case_sensitive_not_supported",
  "invalid_domain",
  "invalid_category",
  // 正则
  "regex_invalid",
  "regex_backreference",
  "regex_nested_quantifier",
  "regex_leading_unbounded",
  "regex_adjacent_unbounded",
  "regex_too_slow",
  // 互斥与约束
  "blacklist_allow_rule",
  "full_view_with_redaction",
  "full_view_with_link_filter",
  "login_link_requires_allow_domains",
  "fixed_since_requires_at",
  "code_only_requires_extract",
  // 警告
  "whitelist_no_enabled_allow",
  "ends_with_on_domain",
  "case_sensitive_ignored",
  "sender_name_spoofable",
  "login_link_not_extracted",
  "since_at_ignored",
  "lookback_ignored",
  "regex_probe_unavailable",
] as const;
export type RuleGroupIssueCode = (typeof RULE_GROUP_ISSUE_CODES)[number];

export type RuleGroupIssuePath = Array<string | number>;

export type RuleGroupIssue = {
  code: RuleGroupIssueCode;
  severity: "error" | "warning";
  /** 指向配置里出问题的位置，例如 ['filter','rules',0,'when','all',1,'value'] */
  path: RuleGroupIssuePath;
  /** 给人看的中文说明 */
  message: string;
};

export function ruleGroupError(code: RuleGroupIssueCode, path: RuleGroupIssuePath, message: string): RuleGroupIssue {
  return { code, severity: "error", path, message };
}

export function ruleGroupWarning(code: RuleGroupIssueCode, path: RuleGroupIssuePath, message: string): RuleGroupIssue {
  return { code, severity: "warning", path, message };
}

/** 把路径格式化成 `filter.rules[0].when.all[1]` 形式，便于展示与 trace */
export function formatIssuePath(path: RuleGroupIssuePath): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === "number") return `${acc}[${segment}]`;
    return acc === "" ? segment : `${acc}.${segment}`;
  }, "");
}
