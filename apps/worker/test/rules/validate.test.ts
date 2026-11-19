import { RULE_GROUP_LIMITS, validateRuleGroupConfig, type Cond, type RuleGroupIssue } from "@maillink/shared";
import { describe, expect, it } from "vitest";
import { leaf, makeConfig, rule } from "./helpers";

// 规则组保存校验：结构、上限、字段与操作符、互斥约束、警告（02 §2–§4、§7）。

const validate = (input: unknown) => validateRuleGroupConfig(input, { regexProbe: "skip" });
const errorCodes = (input: unknown) => validate(input).errors.map((issue) => issue.code);
const warningCodes = (input: unknown) => validate(input).warnings.map((issue) => issue.code);
const findError = (input: unknown, code: string): RuleGroupIssue | undefined =>
  validate(input).errors.find((issue) => issue.code === code);

const subjectLeaf = leaf("subject", "contains", "x");
const withRule = (when: Cond, effect: "allow" | "deny" = "deny") => makeConfig({ rules: [rule("r1", effect, when)] });
const nest = (depth: number): Cond => (depth === 0 ? subjectLeaf : { all: [nest(depth - 1)] });
const CHINESE = /[\u4e00-\u9fff]/u;

describe("结构校验", () => {
  it("合法配置通过，extract 省略时补默认 ['code']", () => {
    const config = makeConfig();
    const { extract: _omit, ...present } = config.present;
    const result = validate({ ...config, present });
    expect(result.ok).toBe(true);
    expect(result.ok && result.config.present.extract).toEqual(["code"]);
    expect(result.warnings).toEqual([]);
  });

  it("纯函数：同一输入两次结果相同，且不修改入参", () => {
    const config = withRule(leaf("subject", "contains", ["A", "B"]));
    const snapshot = JSON.stringify(config);
    expect(validate(config)).toEqual(validate(config));
    expect(JSON.stringify(config)).toBe(snapshot);
  });

  it.each<[string, unknown, string, Array<string | number>]>([
    ["缺 schema_version", (({ schema_version: _v, ...rest }) => rest)(makeConfig()), "required", ["schema_version"]],
    ["版本不认识", { ...makeConfig(), schema_version: 2 }, "unsupported_schema_version", ["schema_version"]],
    ["版本类型不对", { ...makeConfig(), schema_version: "1" }, "invalid_value", ["schema_version"]],
    ["根上多余字段", { ...makeConfig(), extra: 1 }, "unknown_field", ["extra"]],
    ["规则字段拼错", makeConfig({ rules: [{ ...rule("r1", "deny", subjectLeaf), efect: "deny" } as never] }), "unknown_field", ["filter", "rules", 0, "efect"]],
    ["不认识的条件字段", withRule(leaf("subjekt", "contains", "x")), "invalid_value", ["filter", "rules", 0, "when", "field"]],
    ["不认识的操作符", withRule(leaf("subject", "like", "x")), "invalid_value", ["filter", "rules", 0, "when", "op"]],
    ["all 不是数组", withRule({ all: "x" } as never), "invalid_type", ["filter", "rules", 0, "when", "all"]],
    ["条件形状不对", withRule({ foo: 1 } as never), "invalid_condition", ["filter", "rules", 0, "when"]],
    ["叶子条件多余字段", withRule({ ...subjectLeaf, extra: 1 } as never), "unknown_field", ["filter", "rules", 0, "when", "extra"]],
    ["嵌套条件里的错误带完整路径", withRule({ all: [subjectLeaf, { any: [leaf("subject", 3, "x")] }] }), "invalid_value", ["filter", "rules", 0, "when", "all", 1, "any", 0, "op"]],
    ["value 类型不对", withRule(leaf("subject", "contains", { a: 1 })), "invalid_type", ["filter", "rules", 0, "when", "value"]],
    ["links 取值不对", makeConfig({ present: { links: "hide" as never } }), "invalid_value", ["present", "links"]],
    ["links 对象拼错", makeConfig({ present: { links: { allow: [] } as never } }), "unknown_field", ["present", "links", "allow"]],
    ["窗口为 0", makeConfig({ time: { window_minutes: 0, since: { type: "none" } } }), "out_of_range", ["time", "window_minutes"]],
    ["窗口非整数", makeConfig({ time: { window_minutes: 1.5, since: { type: "none" } } }), "invalid_type", ["time", "window_minutes"]],
    ["max_mails 为 0", makeConfig({ limits: { max_mails: 0 } }), "out_of_range", ["limits", "max_mails"]],
    ["max_mails 超上限", makeConfig({ limits: { max_mails: RULE_GROUP_LIMITS.maxMailsCap + 1 } }), "out_of_range", ["limits", "max_mails"]],
    ["规则名为空", makeConfig({ rules: [{ ...rule("r1", "deny", subjectLeaf), name: "" }] }), "out_of_range", ["filter", "rules", 0, "name"]],
    ["规则名过长", makeConfig({ rules: [{ ...rule("r1", "deny", subjectLeaf), name: "名".repeat(RULE_GROUP_LIMITS.maxNameLength + 1) }] }), "out_of_range", ["filter", "rules", 0, "name"]],
  ])("%s", (_name, input, code, path) => {
    const result = validate(input);
    expect(result.ok).toBe(false);
    const issue = result.errors.find((e) => e.code === code);
    expect(issue, JSON.stringify(result.errors)).toBeDefined();
    expect(issue?.path).toEqual(path);
    expect(issue?.message).toMatch(CHINESE);
  });

  it("超深的原始 JSON 在递归解析前被拒绝", () => {
    const deep = nest(RULE_GROUP_LIMITS.rawDepthGuard + 5);
    expect(errorCodes(withRule(deep))).toEqual(["cond_too_deep"]);
  });
});

describe("上限（02 §7）", () => {
  const manyRules = (count: number) =>
    makeConfig({ rules: Array.from({ length: count }, (_, i) => rule(`r${i}`, "deny", subjectLeaf)) });
  const leaves = (count: number): Cond => ({ any: Array.from({ length: count }, () => subjectLeaf) });
  const regexes = (count: number) =>
    makeConfig({ rules: [rule("r1", "deny", leaf("subject", "regex", Array.from({ length: count }, (_, i) => `a${i}`)))] });
  const redactions = (count: number) =>
    makeConfig({
      present: {
        redact: Array.from({ length: count }, (_, i) => ({ name: `d${i}`, match: { type: "text" as const, pattern: `p${i}` }, scope: ["body" as const], replace: "*" })),
      },
    });

  it.each<[string, unknown, unknown, string]>([
    ["规则数", manyRules(RULE_GROUP_LIMITS.maxRules), manyRules(RULE_GROUP_LIMITS.maxRules + 1), "too_many_rules"],
    [
      "条件叶子数（含停用规则）",
      makeConfig({ rules: [rule("a", "deny", leaves(30)), rule("b", "deny", leaves(30), false)] }),
      makeConfig({ rules: [rule("a", "deny", leaves(30)), rule("b", "deny", leaves(31), false)] }),
      "too_many_leaves",
    ],
    ["嵌套深度", withRule(nest(RULE_GROUP_LIMITS.maxDepth)), withRule(nest(RULE_GROUP_LIMITS.maxDepth + 1)), "cond_too_deep"],
    [
      "not 也算一层",
      withRule({ all: [{ any: [{ not: subjectLeaf }] }] }),
      withRule({ all: [{ any: [{ not: { not: subjectLeaf } }] }] }),
      "cond_too_deep",
    ],
    [
      "value 数组长度",
      withRule(leaf("subject", "contains", Array.from({ length: 200 }, (_, i) => `k${i}`))),
      withRule(leaf("subject", "contains", Array.from({ length: 201 }, (_, i) => `k${i}`))),
      "value_list_too_long",
    ],
    ["正则长度", withRule(leaf("subject", "regex", "a".repeat(200))), withRule(leaf("subject", "regex", "a".repeat(201))), "regex_too_long"],
    [
      "code_regex 长度",
      makeConfig({ present: { code_regex: "a".repeat(200) } }),
      makeConfig({ present: { code_regex: "a".repeat(201) } }),
      "regex_too_long",
    ],
    ["脱敏规则数", redactions(RULE_GROUP_LIMITS.maxRedactions), redactions(RULE_GROUP_LIMITS.maxRedactions + 1), "too_many_redactions"],
    ["正则总数（补充项）", regexes(RULE_GROUP_LIMITS.maxRegexPatterns), regexes(RULE_GROUP_LIMITS.maxRegexPatterns + 1), "too_many_regex"],
    [
      "allow_domains 条数（补充项）",
      makeConfig({ present: { links: { allow_domains: Array.from({ length: 100 }, (_, i) => `d${i}.com`) } } }),
      makeConfig({ present: { links: { allow_domains: Array.from({ length: 101 }, (_, i) => `d${i}.com`) } } }),
      "value_list_too_long",
    ],
  ])("%s：恰好到上限通过，超过报错", (_name, atLimit, overLimit, code) => {
    expect(errorCodes(atLimit)).toEqual([]);
    expect(errorCodes(overLimit)).toContain(code);
  });
});

describe("字段与操作符、取值", () => {
  it.each<[string, Cond, string, Array<string | number>]>([
    ["布尔字段用 contains", leaf("code.present", "contains", "x"), "op_not_supported_for_field", ["op"]],
    ["文本字段用 domain_is", leaf("subject", "domain_is", "apple.com"), "op_not_supported_for_field", ["op"]],
    ["文本字段用 gt", leaf("subject", "gt", 3), "op_not_supported_for_field", ["op"]],
    ["数字字段用 eq", leaf("size", "eq", "3"), "op_not_supported_for_field", ["op"]],
    ["分类用 contains", leaf("category", "contains", "billing"), "op_not_supported_for_field", ["op"]],
    ["is 取文本", leaf("has_attachment", "is", "true"), "value_type_mismatch", ["value"]],
    ["gt 取文本", leaf("size", "gt", "100"), "value_type_mismatch", ["value"]],
    ["contains 取数字", leaf("subject", "contains", 3), "value_type_mismatch", ["value"]],
    ["is 不支持 case_sensitive", leaf("has_attachment", "is", true, true), "case_sensitive_not_supported", ["case_sensitive"]],
    ["domain_is 不支持 case_sensitive", leaf("sender.domain", "domain_is", "a.com", true), "case_sensitive_not_supported", ["case_sensitive"]],
    ["空数组", leaf("subject", "contains", []), "empty_value", ["value"]],
    ["空文本", leaf("subject", "contains", ""), "empty_value", ["value"]],
    ["只有空白", leaf("subject", "contains", ["ok", "  "]), "empty_value", ["value", 1]],
    ["只有零宽字符", leaf("subject", "contains", "\u200B\u00AD"), "empty_value", ["value"]],
    ["域名带 @", leaf("sender.domain", "domain_is", "@apple.com"), "invalid_domain", ["value"]],
    ["域名带通配符", leaf("sender.domain", "domain_is", ["apple.com", "*.apple.com"]), "invalid_domain", ["value", 1]],
    ["域名带协议", leaf("link.domains", "domain_is", "https://apple.com"), "invalid_domain", ["value"]],
    ["不认识的分类", leaf("category", "eq", ["billing", "spam"]), "invalid_category", ["value", 1]],
    ["空 all", { all: [] }, "empty_condition_group", ["all"]],
    ["空 any", { not: { any: [] } }, "empty_condition_group", ["not", "any"]],
    ["正则无法编译", leaf("subject", "regex", "(abc"), "regex_invalid", ["value"]],
    ["反向引用", leaf("subject", "regex", "(a)\\1"), "regex_backreference", ["value"]],
    ["嵌套重复", leaf("body", "regex", "(a+)+$"), "regex_nested_quantifier", ["value"]],
    ["开头无上限重复", leaf("content", "regex", ".*reset"), "regex_leading_unbounded", ["value"]],
  ])("%s", (_name, when, code, relative) => {
    const issue = findError(withRule(when), code);
    expect(issue, JSON.stringify(validate(withRule(when)).errors)).toBeDefined();
    expect(issue?.path).toEqual(["filter", "rules", 0, "when", ...relative]);
    expect(issue?.message).toMatch(CHINESE);
  });

  it.each<[string, Cond]>([
    ["域名字段可用文本操作符", leaf("sender.domain", "eq", "apple.com")],
    ["列表字段 regex", leaf("attachment.name", "regex", "\\.pdf$")],
    ["分类单值", leaf("category", "eq", "billing")],
    ["数字比较", { all: [leaf("size", "gt", 0), leaf("size", "lt", 1e7)] }],
    ["区分大小写的文本条件", leaf("subject", "eq", "Code", true)],
    ["布尔", leaf("login_link.present", "is", false)],
  ])("合法：%s", (_name, when) => {
    expect(errorCodes(withRule(when))).toEqual([]);
  });

  it("规则 id 重复", () => {
    const config = makeConfig({ rules: [rule("same", "deny", subjectLeaf), rule("same", "deny", subjectLeaf)] });
    expect(findError(config, "duplicate_rule_id")?.path).toEqual(["filter", "rules", 1, "id"]);
  });
});

describe("模式与互斥约束", () => {
  it("黑名单里出现 allow 规则（即使停用）被拒，并当场说明原因", () => {
    const config = makeConfig({ mode: "blacklist", rules: [rule("d", "deny", subjectLeaf), rule("a", "allow", subjectLeaf, false)] });
    const issue = findError(config, "blacklist_allow_rule");
    expect(issue?.path).toEqual(["filter", "rules", 1, "effect"]);
    expect(issue?.message).toContain("黑名单");
  });

  it.each<[string, ReturnType<typeof makeConfig>]>([
    ["没有规则", makeConfig({ mode: "whitelist", rules: [] })],
    ["只有 deny", makeConfig({ mode: "whitelist", rules: [rule("d", "deny", subjectLeaf)] })],
    ["唯一的 allow 被停用", makeConfig({ mode: "whitelist", rules: [rule("a", "allow", subjectLeaf, false)] })],
  ])("白名单没有启用的 allow 规则只是警告：%s", (_name, config) => {
    const result = validate(config);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(["whitelist_no_enabled_allow"]);
  });

  const redact = [{ name: "手机号", match: { type: "regex" as const, pattern: "1\\d{10}" }, scope: ["body" as const], replace: "***" }];

  it.each<[string, Parameters<typeof makeConfig>[0], string | null]>([
    ["full + 脱敏", { present: { view: "full", redact } }, "full_view_with_redaction"],
    ["full + strip", { present: { view: "full", links: "strip" } }, "full_view_with_link_filter"],
    ["full + allow_domains", { present: { view: "full", links: { allow_domains: ["a.com"] } } }, "full_view_with_link_filter"],
    ["text + 脱敏 + strip 合法", { present: { view: "text", redact, links: "strip" } }, null],
    ["code_only + strip 合法", { present: { view: "code_only", links: "strip" } }, null],
    ["login_link + strip", { present: { view: "code_only", extract: ["code", "login_link"], links: "strip" } }, "login_link_requires_allow_domains"],
    ["login_link + keep", { present: { view: "code_only", extract: ["login_link"], links: "keep" } }, "login_link_requires_allow_domains"],
    ["login_link + 空 allow_domains", { present: { view: "code_only", extract: ["login_link"], links: { allow_domains: [] } } }, "login_link_requires_allow_domains"],
    ["login_link + allow_domains 合法", { present: { view: "code_only", extract: ["login_link"], links: { allow_domains: ["openai.com"] } } }, null],
    ["code_only 没选提取内容", { present: { view: "code_only", extract: [] } }, "code_only_requires_extract"],
    ["fixed 缺 at", { time: { since: { type: "fixed" } } }, "fixed_since_requires_at"],
    ["fixed 带 at 合法", { time: { since: { type: "fixed", at: 1_700_000_000 } } }, null],
    ["allow_domains 里有非法域名", { present: { links: { allow_domains: ["openai.com", "https://x.com"] } } }, "invalid_domain"],
    ["脱敏内容为空", { present: { redact: [{ ...redact[0]!, match: { type: "text", pattern: " " } }] } }, "empty_value"],
    ["脱敏正则非法", { present: { redact: [{ ...redact[0]!, match: { type: "regex", pattern: "[" } }] } }, "regex_invalid"],
    ["code_regex 非法", { present: { code_regex: "(" } }, "regex_invalid"],
  ])("%s", (_name, overrides, code) => {
    const codes = errorCodes(makeConfig(overrides));
    if (code === null) expect(codes).toEqual([]);
    else expect(codes).toContain(code);
  });

  it("互斥约束的报错位置与说明", () => {
    const issue = findError(makeConfig({ present: { view: "full", redact } }), "full_view_with_redaction");
    expect(issue?.path).toEqual(["present", "view"]);
    expect(issue?.message).toContain("HTML");
  });
});

describe("警告（不阻止保存）", () => {
  it.each<[string, Parameters<typeof makeConfig>[0], string]>([
    ["域名字段用 ends_with", { rules: [rule("d", "deny", leaf("sender.domain", "ends_with", "apple.com"))] }, "ends_with_on_domain"],
    ["只靠显示名做白名单", { mode: "whitelist", rules: [rule("a", "allow", leaf("sender.name", "eq", "Apple"))] }, "sender_name_spoofable"],
    ["用了 login_link.present 但没提取", { rules: [rule("d", "deny", leaf("login_link.present", "is", true))] }, "login_link_not_extracted"],
    ["分类条件写了 case_sensitive", { rules: [rule("d", "deny", leaf("category", "eq", "billing", true))] }, "case_sensitive_ignored"],
    ["非 fixed 却填了 at", { time: { since: { type: "none", at: 1 } } }, "since_at_ignored"],
    ["无锚点却填了 lookback", { time: { since: { type: "fixed", at: 1, lookback_minutes: 5 } } }, "lookback_ignored"],
  ])("%s", (_name, overrides, code) => {
    const config = makeConfig(overrides);
    expect(validate(config).ok).toBe(true);
    expect(warningCodes(config)).toContain(code);
  });

  it("显示名与发件人域名一起用时不警告", () => {
    const when: Cond = { all: [leaf("sender.name", "eq", "Apple"), leaf("sender.domain", "domain_is", "apple.com")] };
    expect(warningCodes(makeConfig({ mode: "whitelist", rules: [rule("a", "allow", when)] }))).toEqual([]);
  });
});
