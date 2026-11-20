import { describe, expect, it } from "vitest";
import type { CondLeaf, Rule, RuleGroupConfig, RuleGroupIssue } from "@maillink/shared";
import { ApiError } from "../../api/errors";
import { BLANK_CONFIG, flattenWhen, newRule } from "./config";
import { mergeIssues, nameProblem, validateLive } from "./editor/editor-state";
import { errorsOf, issuesAt, issuesExactlyAt, issuesFromApiError, splitRuleIssues, warningsOf } from "./issues";

const leaf = (field: CondLeaf["field"], op: CondLeaf["op"], value: CondLeaf["value"]): CondLeaf => ({ field, op, value });
const rule = (id: string, effect: Rule["effect"], when: Rule["when"]): Rule => ({ id, name: id, enabled: true, effect, when });

function config(patch: Partial<RuleGroupConfig> & { rules?: Rule[]; mode?: "whitelist" | "blacklist" }): RuleGroupConfig {
  const { rules, mode, ...rest } = patch;
  return { ...BLANK_CONFIG, ...rest, filter: { mode: mode ?? "whitelist", rules: rules ?? [rule("allow", "allow", leaf("code.present", "is", true))] } };
}

const find = (issues: readonly RuleGroupIssue[], code: string) => issues.find((issue) => issue.code === code);

describe("即时校验：issue 映射到字段", () => {
  it("脱敏 + 完整视图：issue 指向 present.view，原因写在 message 里（不是悄悄置灰）", () => {
    const c = config({ present: { ...BLANK_CONFIG.present, view: "full", links: "keep", redact: [{ name: "r", match: { type: "text", pattern: "x" }, scope: ["body"], replace: "*" }] } });
    const issues = validateLive(c);
    const hit = find(issues, "full_view_with_redaction");
    expect(hit?.severity).toBe("error");
    expect(hit?.path).toEqual(["present", "view"]);
    expect(hit?.message).toContain("12<b>34</b>");
    expect(issuesAt(issues, ["present", "view"])).toContain(hit);
    expect(issuesAt(issues, ["time"])).toEqual([]);
  });

  it("链接改写 + 完整视图、提取登录链接却没限定域名：各落在 view / extract", () => {
    const c = config({ present: { ...BLANK_CONFIG.present, view: "full", links: "strip", extract: ["code", "login_link"] } });
    const issues = validateLive(c);
    expect(find(issues, "full_view_with_link_filter")?.path).toEqual(["present", "view"]);
    expect(find(issues, "login_link_requires_allow_domains")?.path).toEqual(["present", "extract"]);
  });

  it("固定时间没填 at → time.since.at 的错误；非固定却带 at → 警告", () => {
    const missing = validateLive(config({ time: { since: { type: "fixed" } } }));
    expect(find(missing, "fixed_since_requires_at")?.path).toEqual(["time", "since", "at"]);
    const ignored = validateLive(config({ time: { since: { type: "none", at: 5 } } }));
    expect(find(ignored, "since_at_ignored")?.severity).toBe("warning");
  });

  it("黑名单里的允许规则：错误落在该规则的 effect 上，说明原因", () => {
    const c = config({ mode: "blacklist", rules: [rule("d", "deny", leaf("subject", "contains", "x")), rule("a", "allow", leaf("subject", "contains", "y"))] });
    const hit = find(validateLive(c), "blacklist_allow_rule");
    expect(hit?.path).toEqual(["filter", "rules", 1, "effect"]);
    expect(hit?.message).toContain("黑名单默认全部可见");
  });

  it("域名取值不合法 → 精确到该取值的下标；ends_with 用在域名字段上 → 警告落在 op 上", () => {
    const c = config({ rules: [rule("a", "allow", { all: [leaf("sender.domain", "domain_is", ["ok.com", "@bad"]), leaf("sender.domain", "ends_with", ["apple.com"])] })] });
    const issues = validateLive(c);
    expect(find(issues, "invalid_domain")?.path).toEqual(["filter", "rules", 0, "when", "all", 0, "value", 1]);
    const warn = find(issues, "ends_with_on_domain");
    expect(warn?.severity).toBe("warning");
    expect(warn?.path).toEqual(["filter", "rules", 0, "when", "all", 1, "op"]);
    expect(warn?.message).toContain("fakeapple.com");
  });

  it("结构错误（zod）也带路径；上限与警告分开", () => {
    const issues = validateLive({ ...BLANK_CONFIG, limits: { max_mails: 0 } });
    expect(errorsOf(issues).length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.path[0] === "limits")).toBe(true);
    const blank = validateLive(BLANK_CONFIG);
    expect(errorsOf(blank)).toEqual([]);
    expect(warningsOf(blank).map((w) => w.code)).toEqual(["whitelist_no_enabled_allow"]);
  });

  it("配置整体不是对象（JSON 模式写坏了）：给出错误而不是崩溃", () => {
    expect(errorsOf(validateLive(42)).length).toBeGreaterThan(0);
    expect(errorsOf(validateLive(null)).length).toBeGreaterThan(0);
  });
});

describe("规则卡片内的问题归属", () => {
  it("分组条件：问题归到对应的条件行；effect / 空分组等归到卡片", () => {
    const r = rule("r", "allow", { all: [leaf("subject", "contains", "ok"), leaf("subject", "contains", [])] });
    const c = config({ mode: "blacklist", rules: [r] });
    const mine = issuesAt(validateLive(c), ["filter", "rules", 0]);
    const flat = flattenWhen(r.when);
    const split = splitRuleIssues(mine, ["filter", "rules", 0], flat?.shape ?? "nested", flat?.leaves.length ?? 0);
    expect(split.rows[0]).toEqual([]);
    expect(split.rows[1]?.map((i) => i.code)).toEqual(["empty_value"]);
    expect(split.card.map((i) => i.code)).toEqual(["blacklist_allow_rule"]);
  });

  it("单个叶子：叶子自己的字段问题归到第 0 行；挂在 when 本身上的归卡片", () => {
    const r = rule("r", "allow", leaf("sender.name", "contains", "x"));
    const mine = issuesAt(validateLive(config({ rules: [r] })), ["filter", "rules", 0]);
    const split = splitRuleIssues(mine, ["filter", "rules", 0], "leaf", 1);
    expect(split.card.map((i) => i.code)).toContain("sender_name_spoofable");
    expect(split.rows[0]).toEqual([]);
    const bad = rule("b", "allow", leaf("subject", "contains", []));
    const mineBad = issuesAt(validateLive(config({ rules: [bad] })), ["filter", "rules", 0]);
    expect(splitRuleIssues(mineBad, ["filter", "rules", 0], "leaf", 1).rows[0]?.map((i) => i.code)).toEqual(["empty_value"]);
  });

  it("嵌套条件：所有问题都归卡片（表单没有逐行控件）", () => {
    const nested = rule("n", "deny", { not: { all: [] } });
    const mine = issuesAt(validateLive(config({ rules: [nested, newRule([nested], "allow")] })), ["filter", "rules", 0]);
    const split = splitRuleIssues(mine, ["filter", "rules", 0], "nested", 0);
    expect(split.card.length).toBeGreaterThan(0);
    expect(split.rows).toEqual([]);
  });

  it("issuesExactlyAt 只取指向该路径本身的问题", () => {
    const issues = validateLive(config({ rules: [rule("a", "allow", leaf("subject", "contains", []))] }));
    expect(issuesExactlyAt(issues, ["filter", "rules", 0, "when", "value"])).toHaveLength(1);
    expect(issuesExactlyAt(issues, ["filter", "rules", 0])).toEqual([]);
  });
});

describe("服务端 400 的 issues", () => {
  const issue: RuleGroupIssue = { code: "regex_too_slow", severity: "error", path: ["present", "code_regex"], message: "太慢" };

  it("rule_group_invalid：取出 issues 与 warnings", () => {
    const error = new ApiError(400, "rule_group_invalid", "规则组配置不合法", { issues: [issue], warnings: [] });
    expect(issuesFromApiError(error)).toEqual({ errors: [issue], warnings: [] });
  });

  it("别的错误码、或形状不对：返回 null（不猜）", () => {
    expect(issuesFromApiError(new ApiError(409, "revision_conflict", "x", { issues: [issue] }))).toBeNull();
    expect(issuesFromApiError(new ApiError(400, "rule_group_invalid", "x", { issues: [{ nope: 1 }] }))).toBeNull();
    expect(issuesFromApiError(new Error("x"))).toBeNull();
  });

  it("与本地校验合并时按 code + 路径去重，服务端独有的（试跑计时）保留", () => {
    const local: RuleGroupIssue = { code: "empty_value", severity: "error", path: ["a"], message: "m" };
    const merged = mergeIssues([local], [{ ...local, message: "服务端的" }, issue]);
    expect(merged).toEqual([local, issue]);
  });
});

describe("名称校验", () => {
  it("空与超长都就地报错", () => {
    expect(nameProblem("  ")).toMatch(/不能为空/);
    expect(nameProblem("a".repeat(65))).toMatch(/最长 64/);
    expect(nameProblem("仅验证码")).toBeNull();
  });
});
