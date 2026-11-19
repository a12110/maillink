import type { Cond, Redaction, Rule } from "@maillink/shared";
import { describe, expect, it } from "vitest";
import { compileRuleGroup } from "../../src/rules/compile";
import { evaluate } from "../../src/rules/evaluate";
import type { MailFacts } from "../../src/rules/facts";
import { compileOrThrow, leaf, makeConfig, makeFacts, NOW, okInput, rule } from "./helpers";

// 求值：三步求值、原因、trace、字段与操作符语义、归一化、正文截断、no_code（02 §3.2–§3.5、§8、§10）。

const noBound = { time_lower_bound: null };

function run(config: Parameters<typeof makeConfig>[0], facts: MailFacts = makeFacts()) {
  return evaluate(compileOrThrow(makeConfig(config)), okInput(facts), noBound);
}

const denyReset = rule("deny-reset", "deny", leaf("content", "contains", ["reset your password", "重设密码"]));
const allowOpenai = rule("allow-openai", "allow", leaf("sender.domain", "domain_is", "openai.com"));
const allowApple = rule("allow-apple", "allow", leaf("sender.domain", "domain_is", "apple.com"));
const resetFacts = makeFacts({ subject: "Reset your password", body: "Click to reset your password" });

describe("三步求值的全部分支", () => {
  it.each<[string, Parameters<typeof makeConfig>[0], MailFacts, boolean, string, string]>([
    ["黑名单、无规则 → 可见", { mode: "blacklist" }, makeFacts(), true, "blacklist_pass", "blacklist_pass"],
    ["黑名单、deny 未命中 → 可见", { mode: "blacklist", rules: [denyReset] }, makeFacts(), true, "blacklist_pass", "blacklist_pass"],
    ["黑名单、deny 命中 → 不可见", { mode: "blacklist", rules: [denyReset] }, resetFacts, false, "deny", "deny:规则deny-reset"],
    ["白名单、allow 命中 → 可见", { mode: "whitelist", rules: [allowOpenai] }, makeFacts(), true, "allow_match", "allow:规则allow-openai"],
    ["白名单、allow 未命中 → 不可见", { mode: "whitelist", rules: [allowApple] }, makeFacts(), false, "no_allow_match", "no_allow_match"],
    ["白名单、allow 与 deny 都命中 → deny 优先", { mode: "whitelist", rules: [allowOpenai, denyReset] }, resetFacts, false, "deny", "deny:规则deny-reset"],
    ["白名单、没有规则 → 什么都看不到", { mode: "whitelist", rules: [] }, makeFacts(), false, "no_allow_match", "no_allow_match"],
    [
      "白名单、唯一会命中的 allow 被停用 → 不会变成全部可见",
      { mode: "whitelist", rules: [{ ...allowOpenai, enabled: false }] },
      makeFacts(),
      false,
      "no_allow_match",
      "no_allow_match",
    ],
    ["停用的 deny 不生效", { mode: "blacklist", rules: [{ ...denyReset, enabled: false }] }, resetFacts, true, "blacklist_pass", "blacklist_pass"],
    ["多条 allow 之间是或", { mode: "whitelist", rules: [allowApple, allowOpenai] }, makeFacts(), true, "allow_match", "allow:规则allow-openai"],
  ])("%s", (_name, config, facts, visible, code, reason) => {
    const result = run(config, facts);
    expect(result.visible).toBe(visible);
    expect(result.reason_code).toBe(code);
    expect(result.reason).toBe(reason);
  });

  it("解析失败 → parse_failed，不做提取", () => {
    const compiled = compileOrThrow(makeConfig());
    const result = evaluate(compiled, { kind: "failed", mail_id: 9, received_at: NOW }, noBound);
    expect(result).toEqual({
      mail_id: 9,
      received_at: NOW,
      visible: false,
      reason_code: "parse_failed",
      reason: "parse_failed",
      reason_rule: null,
      matched: [],
      extracted: null,
    });
  });

  it.each([
    [NOW - 601, false],
    [NOW - 600, true],
    [NOW, true],
  ])("时间下界纵深判定：received_at=%i → visible=%s", (receivedAt, visible) => {
    const compiled = compileOrThrow(makeConfig());
    const result = evaluate(compiled, okInput(makeFacts({ received_at: receivedAt })), { time_lower_bound: NOW - 600 });
    expect(result.visible).toBe(visible);
    if (!visible) expect(result.reason_code).toBe("out_of_window");
  });
});

describe("与规则顺序无关", () => {
  const rules: Rule[] = [
    allowOpenai,
    allowApple,
    denyReset,
    rule("deny-billing", "deny", leaf("category", "eq", "billing")),
    rule("allow-code", "allow", leaf("code.present", "is", true)),
  ];
  const permutations = <T>(items: T[]): T[][] =>
    items.length <= 1 ? [items] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
  const samples: MailFacts[] = [
    makeFacts(),
    resetFacts,
    makeFacts({ category: "billing" }),
    makeFacts({ sender: { addresses: ["a@x.io"], domains: ["x.io"] }, code: null }),
    makeFacts({ sender: { addresses: ["no-reply@id.apple.com"], domains: ["id.apple.com"] }, code: null }),
  ];

  it.each(["whitelist", "blacklist"] as const)("%s：所有排列给出相同的可见性、原因码与命中集合", (mode) => {
    const usable = mode === "blacklist" ? rules.filter((r) => r.effect === "deny") : rules;
    for (const facts of samples) {
      const outcomes = permutations(usable).map((order) => {
        const result = run({ mode, rules: order }, facts);
        return { visible: result.visible, code: result.reason_code, matched: result.matched.map((m) => m.rule_id).sort() };
      });
      for (const outcome of outcomes) expect(outcome).toEqual(outcomes[0]);
    }
  });
});

describe("字段语义（02 §3.3）", () => {
  const hme = makeFacts({
    sender: {
      addresses: ["relay_abc@icloud.com", "noreply@tm.openai.com"],
      domains: ["icloud.com", "tm.openai.com"],
      name: null,
      envelope: "bounce@icloud.com",
    },
    links: ["https://auth.openai.com/login?x=1", "https://tracker.example.net/p.gif"],
    link_domains: ["auth.openai.com", "tracker.example.net"],
    attachments: [{ name: "Invoice-2026.PDF", content_type: "application/pdf", size: 1000 }],
    raw_size: 50_000,
  });

  it.each<[string, Cond, boolean]>([
    ["sender.address 任一候选（HME s=）命中", leaf("sender.address", "eq", "noreply@tm.openai.com"), true],
    ["sender.address 都不命中", leaf("sender.address", "eq", "x@openai.com"), false],
    ["sender.domain 候选里有子域名", leaf("sender.domain", "domain_is", "openai.com"), true],
    ["sender.name 为空时文本条件不命中", leaf("sender.name", "contains", "OpenAI"), false],
    ["sender.name 为空时 not 成立", { not: leaf("sender.name", "contains", "OpenAI") }, true],
    ["sender.envelope", leaf("sender.envelope", "ends_with", "@icloud.com"), true],
    ["recipient", leaf("recipient", "eq", "ALIAS123@icloud.com"), true],
    ["subject", leaf("subject", "starts_with", "your chatgpt"), true],
    ["body", leaf("body", "contains", "temporary verification"), true],
    ["content = subject + body（主题里的词）", leaf("content", "contains", "chatgpt code"), true],
    ["content = subject + body（正文里的词）", leaf("content", "contains", "to continue"), true],
    ["link.domains 任一元素", leaf("link.domains", "domain_is", "example.net"), true],
    ["link.domains 都不命中", leaf("link.domains", "domain_is", "evil.io"), false],
    ["code.present is true", leaf("code.present", "is", true), true],
    ["code.present is false", leaf("code.present", "is", false), false],
    ["login_link.present（未配置提取）恒为 false", leaf("login_link.present", "is", false), true],
    ["category 单值", leaf("category", "eq", "verification"), true],
    ["category 数组任一", leaf("category", "eq", ["billing", "other"]), false],
    ["has_attachment", leaf("has_attachment", "is", true), true],
    ["attachment.name 列表任一，忽略大小写", leaf("attachment.name", "ends_with", ".pdf"), true],
    ["size gt", leaf("size", "gt", 49_999), true],
    ["size lt", leaf("size", "lt", 50_000), false],
  ])("%s", (_name, when, matched) => {
    const result = run({ mode: "whitelist", rules: [rule("r", "allow", when)] }, hme);
    expect(result.visible).toBe(matched);
  });

  it("login_link.present 按本规则组配置提取后的结果", () => {
    const present = { view: "code_only" as const, extract: ["login_link" as const], links: { allow_domains: ["openai.com"] } };
    const allow = rule("r", "allow", leaf("login_link.present", "is", true));
    expect(run({ mode: "whitelist", rules: [allow], present }, hme).visible).toBe(true);
    const otherDomain = { ...present, links: { allow_domains: ["apple.com"] } };
    expect(run({ mode: "whitelist", rules: [allow], present: otherDomain }, hme).reason_code).toBe("no_allow_match");
  });
});

describe("操作符（02 §3.4）", () => {
  const facts = makeFacts({ subject: "Your Code Is 123456" });
  it.each<[string, Cond, boolean]>([
    ["默认不区分大小写", leaf("subject", "contains", "YOUR CODE"), true],
    ["case_sensitive 开启后区分", leaf("subject", "contains", "your code", true), false],
    ["case_sensitive 开启且大小写一致", leaf("subject", "contains", "Your Code", true), true],
    ["value 数组表示任一", leaf("subject", "contains", ["nope", "is 123"]), true],
    ["eq 整体相等", leaf("subject", "eq", "your code is 123456"), true],
    ["eq 不是包含", leaf("subject", "eq", "your code"), false],
    ["starts_with", leaf("subject", "starts_with", "your"), true],
    ["ends_with", leaf("subject", "ends_with", "123456"), true],
    ["regex 默认不区分大小写", leaf("subject", "regex", "code is \\d{6}$"), true],
    ["regex case_sensitive", leaf("subject", "regex", "code is", true), false],
    ["regex 数组任一", leaf("subject", "regex", ["^x", "\\d{6}"]), true],
  ])("%s", (_name, when, matched) => {
    expect(run({ mode: "whitelist", rules: [rule("r", "allow", when)] }, facts).visible).toBe(matched);
  });

  it.each([
    ["apple.com", true],
    ["id.apple.com", true],
    ["Mail.ID.Apple.COM.", true],
    ["fakeapple.com", false],
    ["apple.com.evil.io", false],
    ["notapple.com", false],
  ])("domain_is 按点号边界：%s → %s", (domain, matched) => {
    const facts = makeFacts({ sender: { addresses: [`x@${domain}`], domains: [domain] } });
    const result = run({ mode: "whitelist", rules: [rule("r", "allow", leaf("sender.domain", "domain_is", "Apple.com."))] }, facts);
    expect(result.visible).toBe(matched);
  });

  it("ends_with 会误放 fakeapple.com（这就是推荐 domain_is 的原因）", () => {
    const facts = makeFacts({ sender: { addresses: ["x@fakeapple.com"], domains: ["fakeapple.com"] } });
    expect(run({ mode: "whitelist", rules: [rule("r", "allow", leaf("sender.domain", "ends_with", "apple.com"))] }, facts).visible).toBe(true);
  });
});

describe("归一化后比较", () => {
  it.each<[string, string, string]>([
    ["规则值全角", "ｒｅｓｅｔ　ｙｏｕｒ　ｐａｓｓｗｏｒｄ", "Please reset your password"],
    ["规则值带零宽字符", "re\u200Bset your pass\u00ADword", "Please reset your password"],
    ["邮件里有全角（上游未归一化时兜底）", "reset your password", "Please ＲＥＳＥＴ your password"],
    ["邮件里有零宽与软连字符", "reset your password", "Please re\u200Bset your pass\u00ADword"],
    ["邮件里有多余空白与换行", "reset your password", "Please reset \n\n your\t\tpassword"],
    ["大小写", "RESET YOUR PASSWORD", "please Reset Your Password"],
    ["中文全角标点", "验证码:", "您的验证码：123456"],
  ])("%s", (_name, ruleValue, body) => {
    const facts = makeFacts({ body });
    const result = run({ mode: "blacklist", rules: [rule("d", "deny", leaf("body", "contains", ruleValue))] }, facts);
    expect(result.reason_code).toBe("deny");
  });

  it("纯文本与 HTML 内容不一致时 deny 仍命中（body 是两者拼接的全集）", () => {
    const textPart = "Your login code is 123456.";
    const htmlAsText = "Someone asked to reset your password. Code: 123456";
    const facts = makeFacts({ subject: "Your code", body: `${textPart} ${htmlAsText}` });
    const result = run({ mode: "whitelist", rules: [allowOpenai, denyReset] }, facts);
    expect(result.reason).toBe("deny:规则deny-reset");
  });
});

describe("trace（02 §8）", () => {
  it("列出所有命中的规则与命中的条件路径、取值与候选", () => {
    const allow = rule("a", "allow", {
      all: [leaf("sender.domain", "domain_is", ["apple.com", "openai.com"]), { any: [leaf("subject", "contains", ["code", "验证码"]), leaf("code.present", "is", true)] }],
    });
    const deny = rule("d", "deny", { not: leaf("category", "eq", "verification") });
    const result = run({ mode: "whitelist", rules: [allow, deny] }, makeFacts());
    expect(result.matched).toEqual([
      {
        rule_id: "a",
        rule_name: "规则a",
        effect: "allow",
        hits: [
          { kind: "leaf", path: "when.all[0]", field: "sender.domain", op: "domain_is", value: "openai.com", candidate: "tm.openai.com" },
          { kind: "leaf", path: "when.all[1].any[0]", field: "subject", op: "contains", value: "code" },
          { kind: "leaf", path: "when.all[1].any[1]", field: "code.present", op: "is", value: "true" },
        ],
      },
    ]);
    expect(result.reason_rule).toEqual({ id: "a", name: "规则a" });
  });

  it("not 成立时记录 not 节点", () => {
    const deny = rule("d", "deny", { not: leaf("category", "eq", "verification") });
    const result = run({ mode: "blacklist", rules: [deny] }, makeFacts({ category: "other" }));
    expect(result.matched[0]?.hits).toEqual([{ kind: "not", path: "when" }]);
  });

  it("多条 deny 都命中时全部列出，原因取配置顺序第一条", () => {
    const d1 = rule("d1", "deny", leaf("subject", "contains", "reset"));
    const d2 = rule("d2", "deny", leaf("body", "contains", "reset"));
    const result = run({ mode: "blacklist", rules: [d1, d2] }, resetFacts);
    expect(result.matched.map((m) => m.rule_id)).toEqual(["d1", "d2"]);
    expect(result.reason).toBe("deny:规则d1");
  });
});

describe("正文被截断（02 §3.5）", () => {
  const truncated = makeFacts({ body_truncated: true });
  const redact: Redaction[] = [{ name: "手机号", match: { type: "regex", pattern: "1\\d{10}" }, scope: ["body"], replace: "***" }];

  it.each<[string, Parameters<typeof makeConfig>[0], string]>([
    ["存在正文类 deny（body）→ 不可见", { rules: [rule("d", "deny", leaf("body", "contains", "zzz"))] }, "body_truncated"],
    ["存在正文类 deny（content，藏在 any 里）→ 不可见", { rules: [rule("d", "deny", { any: [leaf("subject", "eq", "x"), leaf("content", "contains", "zzz")] })] }, "body_truncated"],
    ["存在脱敏规则 → 不可见", { present: { redact } }, "body_truncated"],
    ["deny 只看主题 → 正常判定", { rules: [rule("d", "deny", leaf("subject", "contains", "zzz"))] }, "blacklist_pass"],
    ["停用的正文类 deny 不算", { rules: [rule("d", "deny", leaf("body", "contains", "zzz"), false)] }, "blacklist_pass"],
    ["白名单 allow 用 body contains → 截断只会少命中，正常判定", { mode: "whitelist", rules: [rule("a", "allow", leaf("body", "contains", "verification"))] }, "allow_match"],
    ["（补充）allow 在 not 下用 body → 不可见", { mode: "whitelist", rules: [rule("a", "allow", { not: leaf("body", "contains", "reset") })] }, "body_truncated"],
    ["（补充）allow 用 body regex → 不可见", { mode: "whitelist", rules: [rule("a", "allow", leaf("body", "regex", "continue: \\d+$"))] }, "body_truncated"],
    ["（补充）allow 用 content ends_with → 不可见", { mode: "whitelist", rules: [rule("a", "allow", leaf("content", "ends_with", "123456"))] }, "body_truncated"],
  ])("%s", (_name, config, code) => {
    expect(run(config, truncated).reason_code).toBe(code);
  });

  it("未截断时同样的规则正常判定", () => {
    expect(run({ rules: [rule("d", "deny", leaf("body", "contains", "zzz"))] }).reason_code).toBe("blacklist_pass");
  });

  it("截断但 deny 已经命中 → 原因是 deny", () => {
    const result = run({ rules: [rule("d", "deny", leaf("body", "contains", "verification"))] }, truncated);
    expect(result.reason_code).toBe("deny");
  });
});

describe("no_code（code_only 视图按 extract）", () => {
  const codeOnly = { view: "code_only" as const, links: "strip" as const };
  it.each<[string, Parameters<typeof makeConfig>[0], MailFacts, string]>([
    ["没提取到验证码 → no_code", { present: codeOnly }, makeFacts({ code: null }), "no_code"],
    ["提取到验证码 → 可见", { present: codeOnly }, makeFacts(), "blacklist_pass"],
    ["text 视图没验证码也可见", { present: { view: "text" } }, makeFacts({ code: null }), "blacklist_pass"],
    [
      "只提取登录链接且有链接 → 可见",
      { present: { ...codeOnly, extract: ["login_link"], links: { allow_domains: ["openai.com"] } } },
      makeFacts({ code: null, links: ["https://auth.openai.com/magic?t=1"] }),
      "blacklist_pass",
    ],
    [
      "只提取登录链接、有验证码但没有允许域名的链接 → no_code",
      { present: { ...codeOnly, extract: ["login_link"], links: { allow_domains: ["openai.com"] } } },
      makeFacts({ links: ["https://evil.io/x"] }),
      "no_code",
    ],
    ["deny 优先于 no_code", { present: codeOnly, rules: [denyReset] }, { ...resetFacts, code: null }, "deny"],
    ["白名单未命中优先于 no_code", { present: codeOnly, mode: "whitelist", rules: [allowApple] }, makeFacts({ code: null }), "no_allow_match"],
  ])("%s", (_name, config, facts, code) => {
    expect(run(config, facts).reason_code).toBe(code);
  });
});

describe("编译失败关闭（02 §5）", () => {
  it.each<[string, unknown, string]>([
    ["不是对象", null, "rule_group_invalid"],
    ["JSON 字符串而非对象", JSON.stringify(makeConfig()), "rule_group_invalid"],
    ["版本不认识", { ...makeConfig(), schema_version: 99 }, "rule_group_unsupported_version"],
    ["正则编译失败", makeConfig({ rules: [rule("d", "deny", leaf("body", "regex", "(x"))] }), "rule_group_invalid"],
    ["黑名单含 allow", makeConfig({ rules: [allowOpenai] }), "rule_group_invalid"],
  ])("%s → %s", (_name, raw, code) => {
    const result = compileRuleGroup(raw);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe(code);
    expect(!result.ok && result.error.issues.length).toBeGreaterThan(0);
  });

  it("运行时编译不试跑计时，但静态检查照常拒绝", () => {
    const result = compileRuleGroup(makeConfig({ rules: [rule("d", "deny", leaf("body", "regex", ".*reset"))] }));
    expect(!result.ok && result.error.issues.map((i) => i.code)).toEqual(["regex_leading_unbounded"]);
  });

  it("求值不修改入参", () => {
    const facts = makeFacts();
    const snapshot = JSON.stringify(facts);
    run({ rules: [denyReset] }, facts);
    expect(JSON.stringify(facts)).toBe(snapshot);
  });
});
