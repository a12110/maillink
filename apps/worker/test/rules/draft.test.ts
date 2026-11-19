import { validateRuleGroupConfig } from "@maillink/shared";
import { describe, expect, it } from "vitest";
import { draftRuleFromMail } from "../../src/rules/draft";
import { evaluate } from "../../src/rules/evaluate";
import { extractForGroup } from "../../src/rules/extract";
import type { MailFacts } from "../../src/rules/facts";
import { compileOrThrow, makeConfig, makeFacts, okInput } from "./helpers";

// "以此邮件创建规则"（04 draft-from-mail，06 §3.1 L3）。

/** 草稿规则 + 建议的 code_regex 放进一个白名单规则组：必须能通过完整的保存校验（含试跑） */
function groupFromDraft(facts: MailFacts) {
  const draft = draftRuleFromMail(facts);
  if (draft.rule === null) throw new Error("no rule");
  const config = makeConfig({
    mode: "whitelist",
    rules: [draft.rule],
    present: { view: "code_only", links: "strip", ...(draft.code_regex === null ? {} : { code_regex: draft.code_regex }) },
  });
  const validation = validateRuleGroupConfig(config);
  expect(validation.errors).toEqual([]);
  return { draft, compiled: compileOrThrow(config) };
}

describe("draftRuleFromMail", () => {
  it("典型登录验证码邮件：发件人域名 + 分类 + 泛化后的主题 + 验证码正则", () => {
    const facts = makeFacts();
    const { draft, compiled } = groupFromDraft(facts);
    expect(draft.subject_pattern).toBe("^Your ChatGPT code is \\d{6}$");
    expect(draft.code_regex).toBe("code\\s+is\\s*(\\d{6})");
    expect(draft.rule).toEqual({
      id: "draft-1",
      name: "tm.openai.com 登录验证码",
      enabled: true,
      effect: "allow",
      when: {
        all: [
          { field: "sender.domain", op: "domain_is", value: ["tm.openai.com"] },
          { field: "category", op: "eq", value: "verification" },
          { field: "subject", op: "regex", value: "^Your ChatGPT code is \\d{6}$" },
        ],
      },
    });
    expect(evaluate(compiled, okInput(facts), { time_lower_bound: null }).visible).toBe(true);
    const next = makeFacts({ mail_id: 2, subject: "Your ChatGPT code is 654321", code: "654321" });
    const result = evaluate(compiled, okInput(next), { time_lower_bound: null });
    expect(result.visible).toBe(true);
    expect(result.extracted?.code).toBe("654321");
    expect(result.extracted?.code_origin).toBe("code_regex");
  });

  it("主题不同（例如改密邮件）就不命中：这是 L3 主题白名单的意义", () => {
    const { compiled } = groupFromDraft(makeFacts());
    const reset = makeFacts({ subject: "Your password reset code is 123456" });
    expect(evaluate(compiled, okInput(reset), { time_lower_bound: null }).reason_code).toBe("no_allow_match");
  });

  it("iCloud 转发：排除转发服务域名，只留原始发件人域名", () => {
    const facts = makeFacts({ sender: { addresses: ["x_at_openai@icloud.com", "noreply@openai.com"], domains: ["icloud.com", "openai.com"] } });
    const { draft } = groupFromDraft(facts);
    expect(JSON.stringify(draft.rule?.when)).toContain('{"field":"sender.domain","op":"domain_is","value":["openai.com"]}');
    expect(draft.notes.join("\n")).toContain("icloud.com");
  });

  it("主题里的分隔验证码、邮箱地址、日期都被泛化", () => {
    const facts = makeFacts({ subject: "Code 12 34 56 for alias.x@icloud.com on 2026-11-20", code: "123456" });
    const { draft, compiled } = groupFromDraft(facts);
    expect(draft.subject_pattern).toBe("^Code \\d{2}[ -]?\\d{2}[ -]?\\d{2} for [^\\s@]+@[^\\s@]+ on \\d+-\\d+-\\d+$");
    const other = makeFacts({ subject: "Code 98-76-54 for other@icloud.com on 2027-1-2", code: "987654" });
    expect(evaluate(compiled, okInput(other), { time_lower_bound: null }).visible).toBe(true);
  });

  it("字母数字混合的验证码按形状泛化（不区分大小写）", () => {
    const facts = makeFacts({ subject: "Your code: AB12CD", body: "Use AB12CD to sign in", code: "AB12CD" });
    const { draft, compiled } = groupFromDraft(facts);
    expect(draft.subject_pattern).toBe("^Your code: [a-z0-9]{6}$");
    const other = makeFacts({ subject: "Your code: xy98zw", body: "Use xy98zw", code: "xy98zw" });
    expect(evaluate(compiled, okInput(other), { time_lower_bound: null }).visible).toBe(true);
  });

  it("主题里的正则特殊字符被转义", () => {
    const facts = makeFacts({ subject: "[Action] Code (123456) + more? $5 *now*", code: "123456" });
    const { draft } = groupFromDraft(facts);
    expect(draft.subject_pattern).toBe("^\\[Action\\] Code \\(\\d{6}\\) \\+ more\\? \\$\\d+ \\*now\\*$");
  });

  it("超长主题只保留前缀，去掉结尾锚点，仍能通过校验并匹配原主题", () => {
    const subject = `Your code is 123456 ${"and some very long marketing text ".repeat(10)}`.trim();
    const { draft } = groupFromDraft(makeFacts({ subject }));
    expect(draft.subject_pattern?.startsWith("^Your code is \\d{6} and")).toBe(true);
    expect(draft.subject_pattern?.endsWith("$")).toBe(false);
    expect([...(draft.subject_pattern ?? "")].length).toBeLessThanOrEqual(200);
    expect(draft.notes.join("\n")).toContain("前缀");
  });

  it("只在正文出现的验证码：取中文锚点", () => {
    const facts = makeFacts({ subject: "登录验证", body: "您好，您的验证码是 482913，10 分钟内有效。", code: "482913" });
    const { draft, compiled } = groupFromDraft(facts);
    expect(draft.code_regex).toBe("您的验证码是\\s*(\\d{6})");
    expect(extractForGroup(compiled, facts, "builtin").code_origin).toBe("code_regex");
  });

  it("验证码前紧挨着数字时不用它作锚点", () => {
    const facts = makeFacts({ subject: "Login", body: "Order 5521 123456", code: "123456" });
    expect(draftRuleFromMail(facts).code_regex).toBe("\\b(\\d{6})\\b");
  });

  it("分类不是 verification：不加分类条件并提示", () => {
    const { draft } = groupFromDraft(makeFacts({ category: "other" }));
    expect(JSON.stringify(draft.rule?.when)).not.toContain("category");
    expect(draft.notes.join("\n")).toContain("other");
  });

  it("验证码没有原样出现（来自 ai_extract）：不生成验证码正则", () => {
    const draft = draftRuleFromMail(makeFacts({ subject: "Sign in", body: "See the code in the app", code: "777777" }));
    expect(draft.code_regex).toBeNull();
    expect(draft.subject_pattern).toBe("^Sign in$");
  });

  it("没有验证码：主题保持字面", () => {
    const draft = draftRuleFromMail(makeFacts({ subject: "Welcome aboard", code: null }));
    expect(draft.code_regex).toBeNull();
    expect(draft.subject_pattern).toBe("^Welcome aboard$");
  });

  it("既没有可用域名也没有主题：不生成规则", () => {
    const draft = draftRuleFromMail(makeFacts({ subject: "", sender: { addresses: ["a@icloud.com"], domains: ["icloud.com"] } }));
    expect(draft.rule).toBeNull();
    expect(draft.notes.length).toBeGreaterThan(0);
  });
});
