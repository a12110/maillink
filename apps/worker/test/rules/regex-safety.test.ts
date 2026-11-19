import {
  analyzeRegexPattern,
  clockAdvances,
  compileUserRegex,
  defaultClock,
  probeRegexCost,
  REGEX_PROBE_MAX_RUN_MS,
  validateRuleGroupConfig,
  type Clock,
} from "@maillink/shared";
import { describe, expect, it } from "vitest";
import { leaf, makeConfig, rule } from "./helpers";

// 防灾难性回溯（02 §7）：静态检查（确定性）+ 固定样本试跑计时（时钟可用时）。

describe("静态检查 analyzeRegexPattern", () => {
  it.each<[string, string[]]>([
    ["验证码[:：]?\\s*(\\d{6})", []],
    ["\\b(\\d{3}[ -]?\\d{3})\\b", []],
    ["^.*reset", []],
    ["(?:\\d{3}-?){2}", ["nested_quantifier"]],
    ["(\\d{3}[ -]){2}\\d{3}", []],
    ["x(?:ab)+c", []],
    ["(\\d{3})+", []],
    ["\\d+", []],
    ["[a-z0-9]+", []],
    ["(\\d+)", []],
    ["\\s+$", []],
    ["reset|password", []],
    ["a.*b", []],
    ["[(+*]{2}x", []],
    ["code:\\p{L}{2,}\\d", []],
    ["(?<code>\\d{6})", []],
    ["(?<=code:)\\d{6}", []],
    ["(a+)+$", ["nested_quantifier"]],
    ["^(?:\\d{1,3})+x", ["nested_quantifier"]],
    ["^(\\w+\\s?)*$", ["nested_quantifier"]],
    ["^(a+){2,5}$", ["nested_quantifier"]],
    ["x((ab)*c)+", ["nested_quantifier"]],
    ["(?:\\d{1,3})+x", ["leading_unbounded", "nested_quantifier"]],
    ["(?:ab)+c", ["leading_unbounded"]],
    // 验收反例：带量词的组里有重叠分支 / 固定次数套可变重复（线上计时不可用时必须靠静态检查拒绝）
    ["a(\\w|\\d)+!", ["nested_quantifier"]],
    ["x(\\w*\\s*){20}!", ["nested_quantifier"]],
    ["^(a|a)*$", ["nested_quantifier"]],
    ["^(a?){20}a{20}$", ["nested_quantifier"]],
    ["x(?:(ab){2}c){3}", ["nested_quantifier"]],
    ["x(?:a|b){2}", ["nested_quantifier"]],
    ["x(?:a|b)?y", []],
    ["\\p{L}{2,}\\d", ["leading_unbounded"]],
    ["(a)\\1", ["backreference"]],
    ["(?<x>a)\\k<x>", ["backreference"]],
    [".*x", ["leading_unbounded"]],
    ["\\w+@example\\.com", ["leading_unbounded"]],
    ["(?:.*)reset", ["leading_unbounded"]],
    ["(\\d+)x", ["leading_unbounded"]],
    ["foo|.+bar", ["leading_unbounded"]],
    ["[^x]*y", ["leading_unbounded"]],
  ])("%s → %j", (pattern, expected) => {
    compileUserRegex(pattern, { caseSensitive: false, global: false });
    expect(analyzeRegexPattern(pattern).sort()).toEqual([...expected].sort());
  });
});

describe("试跑计时 probeRegexCost", () => {
  it("当前测试运行时（本地 workerd）计算期间时钟会前进", () => {
    expect(clockAdvances(defaultClock())).toBe(true);
  });

  it("常见的线性正则在全部样本上都通过", () => {
    for (const pattern of ["验证码\\s*(\\d{6})", "reset|password", "\\b\\d{6}\\b", "1\\d{10}", "^.*reset"]) {
      const regex = compileUserRegex(pattern, { caseSensitive: false, global: false });
      expect(probeRegexCost(regex, defaultClock()), pattern).toEqual({ ok: true });
    }
  });

  it("构造的灾难性回溯模式（静态检查抓不到的相邻重叠重复）被计时拒绝", () => {
    const regex = compileUserRegex("1\\d+\\d+\\d+y", { caseSensitive: false, global: false });
    expect(analyzeRegexPattern("1\\d+\\d+\\d+y")).toEqual([]);
    const outcome = probeRegexCost(regex, defaultClock());
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.ms).toBeGreaterThan(REGEX_PROBE_MAX_RUN_MS);
  });

  it("多项式回溯（相邻重叠的重复）在长样本上被计时拒绝", () => {
    const pattern = "1\\d+\\d+y";
    expect(analyzeRegexPattern(pattern)).toEqual([]);
    const outcome = probeRegexCost(compileUserRegex(pattern, { caseSensitive: false, global: false }), defaultClock());
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.unit).toBe("1");
  });

  it("已知局限：需要特定前缀才触发的回溯，固定样本测不到（静态检查与长度上限兜底）", () => {
    const pattern = "x\\d+\\d+y";
    const regex = compileUserRegex(pattern, { caseSensitive: false, global: false });
    expect(analyzeRegexPattern(pattern)).toEqual([]);
    expect(probeRegexCost(regex, defaultClock())).toEqual({ ok: true });
  });
});

describe("保存校验里的正则检查", () => {
  const withRegex = (pattern: string) => makeConfig({ rules: [rule("r1", "deny", leaf("body", "regex", pattern))] });

  it("灾难性回溯模式保存时被拒绝（regex_too_slow），路径指向该取值", () => {
    const result = validateRuleGroupConfig(withRegex("1\\d+\\d+y"));
    expect(result.ok).toBe(false);
    const issue = result.errors.find((e) => e.code === "regex_too_slow");
    expect(issue?.path).toEqual(["filter", "rules", 0, "when", "value"]);
    expect(issue?.message).toContain("灾难性回溯");
  });

  it("嵌套重复在静态检查阶段就被拒绝，不再试跑", () => {
    let calls = 0;
    const clock: Clock = () => {
      calls += 1;
      return calls;
    };
    const result = validateRuleGroupConfig(withRegex("(a+)+$"), { clock });
    expect(result.errors.map((e) => e.code)).toEqual(["regex_nested_quantifier"]);
    expect(calls).toBe(0);
  });

  it("时钟冻结（Workers 线上）时给出警告，不假装测过；静态检查照常生效", () => {
    const frozen: Clock = () => 1000;
    const ok = validateRuleGroupConfig(withRegex("reset|password"), { clock: frozen });
    expect(ok.ok).toBe(true);
    expect(ok.warnings.map((w) => w.code)).toEqual(["regex_probe_unavailable"]);
    const bad = validateRuleGroupConfig(withRegex(".*reset"), { clock: frozen });
    expect(bad.errors.map((e) => e.code)).toEqual(["regex_leading_unbounded"]);
  });

  it("注入的慢时钟：每次读数前进 1 秒，任何正则都判为超时（验证阈值比较）", () => {
    let t = 0;
    const slow: Clock = () => (t += 1000);
    const result = validateRuleGroupConfig(withRegex("reset"), { clock: slow });
    expect(result.errors.map((e) => e.code)).toEqual(["regex_too_slow"]);
  });

  it("regexProbe=skip 时不试跑（运行时编译用）", () => {
    let calls = 0;
    const clock: Clock = () => (calls += 1);
    expect(validateRuleGroupConfig(withRegex("1\\d+\\d+y"), { regexProbe: "skip", clock }).ok).toBe(true);
    expect(calls).toBe(0);
  });

  it("code_regex 与脱敏正则也参与检查", () => {
    const config = makeConfig({
      present: {
        code_regex: ".*(\\d{6})",
        redact: [{ name: "r", match: { type: "regex", pattern: "1\\d+\\d+y" }, scope: ["body"], replace: "*" }],
      },
    });
    const errors = validateRuleGroupConfig(config).errors;
    expect(errors.find((e) => e.code === "regex_leading_unbounded")?.path).toEqual(["present", "code_regex"]);
    expect(errors.find((e) => e.code === "regex_too_slow")?.path).toEqual(["present", "redact", 0, "match", "pattern"]);
  });
});

describe("验收必修：线上只剩静态检查时，反例必须在保存时被拒绝", () => {
  const frozen: Clock = () => 1000;
  const withRegex = (pattern: string) => makeConfig({ rules: [rule("r1", "deny", leaf("body", "regex", pattern))] });

  it.each(["a(\\w|\\d)+!", "x(\\w*\\s*){20}!"])("反例 %s 在时钟冻结时仍被拒绝（regex_nested_quantifier）", (pattern) => {
    const result = validateRuleGroupConfig(withRegex(pattern), { clock: frozen });
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(["regex_nested_quantifier"]);
  });

  it.each([
    "验证码[：:]\\s*(\\d{6})",
    "code is (\\w{4,8})",
    "^\\[OpenAI\\].*",
    "\\b\\d{6}\\b",
    "(?:code|码)\\s*[:：]?\\s*([A-Z0-9]{6})",
  ])("常用写法 %s 不误报", (pattern) => {
    expect(analyzeRegexPattern(compileUserRegex(pattern, { caseSensitive: false, global: false }).source)).toEqual([]);
    const result = validateRuleGroupConfig(makeConfig({ present: { code_regex: pattern } }));
    expect(result.errors).toEqual([]);
  });
});
