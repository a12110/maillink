import { EXTRACTED_CODE_MAX_LENGTH, type CodeStep } from "@maillink/shared";
import { describe, expect, it } from "vitest";
import { cleanCode, extractForGroup, extractLoginLink } from "../../src/rules/extract";
import { compileDomainList } from "../../src/rules/domains";
import type { CodeSource } from "../../src/rules/facts";
import { compileOrThrow, makeConfig, makeFacts } from "./helpers";

// 规则组级提取（02 §4.6）：验证码严格优先级 ai_extract → code_regex → 内置；登录链接按 allow_domains。

const CODE_REGEX = "PIN\\s*(\\d{3}[ -]?\\d{3})";
const SUBJECT_WITH_PIN = "Login PIN 654 321";

type Case = {
  name: string;
  source: CodeSource | null;
  factsCode: string | null;
  regex: boolean;
  subject: string;
  expected: string | null;
  origin: "ai_extract" | "code_regex" | "builtin" | null;
  steps: Array<CodeStep["result"]>;
};

// 三种来源 × 有无 code_regex × code_regex 能否提取到
const CASES: Case[] = [
  { name: "ai_extract，无 code_regex", source: "ai_extract", factsCode: "111-222", regex: false, subject: SUBJECT_WITH_PIN, expected: "111222", origin: "ai_extract", steps: ["used", "not_applicable", "skipped"] },
  { name: "ai_extract，有 code_regex 且能提取：仍用 ai_extract", source: "ai_extract", factsCode: "111 222", regex: true, subject: SUBJECT_WITH_PIN, expected: "111222", origin: "ai_extract", steps: ["used", "skipped", "skipped"] },
  { name: "ai_extract，有 code_regex 但提取不到", source: "ai_extract", factsCode: "111222", regex: true, subject: "Hello", expected: "111222", origin: "ai_extract", steps: ["used", "skipped", "skipped"] },
  { name: "builtin，无 code_regex", source: "builtin", factsCode: "2026", regex: false, subject: SUBJECT_WITH_PIN, expected: "2026", origin: "builtin", steps: ["not_applicable", "not_applicable", "used"] },
  { name: "builtin，code_regex 能提取：覆盖内置（误提取年份的修正）", source: "builtin", factsCode: "2026", regex: true, subject: SUBJECT_WITH_PIN, expected: "654321", origin: "code_regex", steps: ["not_applicable", "used", "skipped"] },
  { name: "builtin，code_regex 提取不到：回退内置", source: "builtin", factsCode: "2026", regex: true, subject: "Hello", expected: "2026", origin: "builtin", steps: ["not_applicable", "no_match", "used"] },
  { name: "无结果，无 code_regex", source: null, factsCode: null, regex: false, subject: SUBJECT_WITH_PIN, expected: null, origin: null, steps: ["not_applicable", "not_applicable", "no_match"] },
  { name: "无结果，code_regex 能提取", source: null, factsCode: null, regex: true, subject: SUBJECT_WITH_PIN, expected: "654321", origin: "code_regex", steps: ["not_applicable", "used", "skipped"] },
  { name: "无结果，code_regex 提取不到", source: null, factsCode: null, regex: true, subject: "Hello", expected: null, origin: null, steps: ["not_applicable", "no_match", "no_match"] },
];

describe("验证码提取的严格优先级", () => {
  it.each(CASES)("$name", (c) => {
    const compiled = compileOrThrow(makeConfig({ present: c.regex ? { code_regex: CODE_REGEX } : {} }));
    const facts = makeFacts({ subject: c.subject, body: "Thanks", code: c.factsCode });
    const result = extractForGroup(compiled, facts, c.source);
    expect(result.code).toBe(c.expected);
    expect(result.code_origin).toBe(c.origin);
    expect(result.code_steps.map((s) => s.step)).toEqual(["ai_extract", "code_regex", "builtin"]);
    expect(result.code_steps.map((s) => s.result)).toEqual(c.steps);
  });

  it("code_regex 先主题后正文：主题没有时从正文取", () => {
    const compiled = compileOrThrow(makeConfig({ present: { code_regex: CODE_REGEX } }));
    const facts = makeFacts({ subject: "Welcome", body: "Your PIN 987-654 expires soon", code: null });
    expect(extractForGroup(compiled, facts, null).code).toBe("987654");
  });

  it("code_regex 主题与正文都有时取主题", () => {
    const compiled = compileOrThrow(makeConfig({ present: { code_regex: CODE_REGEX } }));
    const facts = makeFacts({ subject: "PIN 111111", body: "PIN 222222", code: null });
    expect(extractForGroup(compiled, facts, null).code).toBe("111111");
  });

  it("没有捕获组时取整个匹配", () => {
    const compiled = compileOrThrow(makeConfig({ present: { code_regex: "\\b[A-Z0-9]{3}-[A-Z0-9]{3}\\b" } }));
    expect(extractForGroup(compiled, makeFacts({ subject: "Code AB1-C2D", code: null }), null).code).toBe("AB1C2D");
  });

  it("code_regex 匹配到的不像验证码（整段文字）→ invalid，回退内置", () => {
    const compiled = compileOrThrow(makeConfig({ present: { code_regex: "验证码(.*)" } }));
    const facts = makeFacts({ subject: "您的验证码是 123456，请勿告诉他人", code: "123456" });
    const result = extractForGroup(compiled, facts, "builtin");
    expect(result.code).toBe("123456");
    expect(result.code_origin).toBe("builtin");
    expect(result.code_steps[1]).toEqual({ step: "code_regex", result: "invalid" });
  });

  it("code_regex 在主题命中但结果无效时继续试正文", () => {
    const compiled = compileOrThrow(makeConfig({ present: { code_regex: "code:\\s*(\\S+)" } }));
    const facts = makeFacts({ subject: "Your code: see-the-email-body-for-details", body: "code: 482913", code: null });
    const result = extractForGroup(compiled, facts, null);
    expect(result.code).toBe("482913");
    expect(result.code_steps[1]).toEqual({ step: "code_regex", result: "used" });
  });

  it("ai_extract 结果不像验证码 → invalid，继续走 code_regex", () => {
    const compiled = compileOrThrow(makeConfig({ present: { code_regex: CODE_REGEX } }));
    const facts = makeFacts({ subject: SUBJECT_WITH_PIN, code: "The verification code is in the email body" });
    const result = extractForGroup(compiled, facts, "ai_extract");
    expect(result.code).toBe("654321");
    expect(result.code_steps.map((s) => s.result)).toEqual(["invalid", "used", "skipped"]);
  });

  it("ai_extract 结果无效且没有 code_regex → 无验证码（facts.code 不是内置结果，不能当内置用）", () => {
    const compiled = compileOrThrow(makeConfig());
    const result = extractForGroup(compiled, makeFacts({ code: "not a code!" }), "ai_extract");
    expect(result.code).toBeNull();
    expect(result.code_steps.map((s) => s.result)).toEqual(["invalid", "not_applicable", "not_applicable"]);
  });

  it.each<[string | null, CodeSource | null]>([
    ["123456", null],
    [null, "builtin"],
    [null, "ai_extract"],
  ])("facts.code=%j 与 code_source=%j 不一致时抛错（上游契约错误）", (code, source) => {
    const compiled = compileOrThrow(makeConfig());
    expect(() => extractForGroup(compiled, makeFacts({ code }), source)).toThrow(/不一致/u);
  });

  it.each<[string, string | null]>([
    ["123456", "123456"],
    ["123 456", "123456"],
    ["123-456", "123456"],
    ["１２３－４５６", "123456"],
    ["AB12CD", "AB12CD"],
    ["G\u2013123456", "G123456"],
    ["  987 654 ", "987654"],
    ["", null],
    [" - ", null],
    ["12.34", null],
    ["验证码", null],
    ["a".repeat(EXTRACTED_CODE_MAX_LENGTH + 1), null],
    ["a".repeat(EXTRACTED_CODE_MAX_LENGTH), "a".repeat(EXTRACTED_CODE_MAX_LENGTH)],
    ["The verification code is below", null],
  ])("cleanCode(%j) = %j", (raw, expected) => {
    expect(cleanCode(raw)).toBe(expected);
  });
});

describe("登录链接提取", () => {
  const allow = compileDomainList(["openai.com"]);
  it.each<[string, string[], string | null]>([
    ["取第一个域名落在 allow_domains 内的链接", ["https://evil.io/a", "https://auth.openai.com/magic?t=1", "https://openai.com/b"], "https://auth.openai.com/magic?t=1"],
    ["主域名本身", ["https://openai.com/login"], "https://openai.com/login"],
    ["后缀相似的域名不算", ["https://fakeopenai.com/x", "https://openai.com.evil.io/x"], null],
    ["非 http(s) 协议不算", ["javascript:alert(1)", "ftp://openai.com/x", "mailto:a@openai.com"], null],
    ["主机名大小写与尾点", ["HTTPS://Auth.OpenAI.com./x"], "https://auth.openai.com./x"],
    ["无法解析的链接跳过", ["not a url", "https://openai.com/ok"], "https://openai.com/ok"],
    ["没有链接", [], null],
  ])("%s", (_name, links, expected) => {
    expect(extractLoginLink(allow, links)).toBe(expected);
  });

  it("没有 allow_domains 时不提取", () => {
    expect(extractLoginLink(null, ["https://openai.com/x"])).toBeNull();
    expect(extractLoginLink([], ["https://openai.com/x"])).toBeNull();
  });

  it("extract 不含 login_link 时规则组级不提取", () => {
    const compiled = compileOrThrow(makeConfig({ present: { links: { allow_domains: ["openai.com"] } } }));
    expect(extractForGroup(compiled, makeFacts({ links: ["https://openai.com/x"] }), "builtin").login_link).toBeNull();
  });

  it("extract 含 login_link 时提取", () => {
    const compiled = compileOrThrow(
      makeConfig({ present: { view: "code_only", extract: ["code", "login_link"], links: { allow_domains: ["openai.com"] } } }),
    );
    expect(extractForGroup(compiled, makeFacts({ links: ["https://openai.com/x"] }), "builtin").login_link).toBe("https://openai.com/x");
  });
});
