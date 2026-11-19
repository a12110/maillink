import { domainIs, isValidDomain, normalizeDomain, normalizeText } from "@maillink/shared";
import { describe, expect, it } from "vitest";
import { compileDomainList, matchDomain } from "../../src/rules/domains";

describe("normalizeText（01 §4.1：NFKC → 去零宽与软连字符 → 合并空白）", () => {
  it.each([
    ["全角字母数字", "ＲＥＳＥＴ　ｐａｓｓｗｏｒｄ１２３", "RESET password123"],
    ["全角标点", "验证码：１２３４５６", "验证码:123456"],
    ["零宽空格", "re\u200Bset", "reset"],
    ["零宽连接符与不连接符", "pass\u200Dwo\u200Cr\u2060d", "password"],
    ["BOM", "\uFEFFhello", "hello"],
    ["软连字符", "pass\u00ADword", "password"],
    ["双向控制符", "a\u202Eb\u2066c\u2069", "abc"],
    ["多余空白、换行、制表符", "  reset \n\n\t your   password  ", "reset your password"],
    ["不间断空格", "a\u00A0\u00A0b", "a b"],
    ["表意空格", "重设\u3000密码", "重设 密码"],
    ["兼容字符（连字、上标）", "ﬁle ²", "file 2"],
    ["大小写保留（比较时再处理）", "Reset", "Reset"],
    ["空串", "", ""],
  ])("%s", (_name, input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });

  it.each([
    "e\u200B\u0301",
    "  Ｒｅｓｅｔ\u00AD \u200B 密码 ",
    "\u0301leading combining",
    "a\u00A0\u0301",
    "x\uFEFF\u0308y",
    "ＡＢＣ\n\n１２３",
  ])("幂等：%j", (input) => {
    const once = normalizeText(input);
    expect(normalizeText(once)).toBe(once);
  });

  it("零宽字符夹在字母与组合符之间：去掉后重新组合", () => {
    expect(normalizeText("e\u200B\u0301")).toBe("\u00E9");
  });
});

describe("域名", () => {
  it.each([
    ["Apple.COM.", "apple.com"],
    ["  ID.Apple.com ", "id.apple.com"],
    ["ａｐｐｌｅ．ｃｏｍ", "apple.com"],
    ["apple.com..", "apple.com"],
  ])("normalizeDomain(%j) = %j", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each([
    ["apple.com", true],
    ["id.apple.com", true],
    ["xn--fsqu00a.com", true],
    ["例子.com", true],
    ["com", true],
    ["@apple.com", false],
    ["*.apple.com", false],
    ["https://apple.com", false],
    ["apple.com/path", false],
    ["apple .com", false],
    ["-apple.com", false],
    ["apple..com", false],
    ["", false],
  ])("isValidDomain(%j) = %s", (input, expected) => {
    expect(isValidDomain(input)).toBe(expected);
  });

  it.each([
    ["apple.com", "apple.com", true],
    ["id.apple.com", "apple.com", true],
    ["a.b.id.apple.com", "apple.com", true],
    ["fakeapple.com", "apple.com", false],
    ["apple.com.evil.io", "apple.com", false],
    ["apple.co", "apple.com", false],
    ["com", "apple.com", false],
    ["", "apple.com", false],
    ["apple.com", "", false],
  ])("domainIs(%j, %j) = %s", (candidate, rule, expected) => {
    expect(domainIs(candidate, rule)).toBe(expected);
  });

  it.each([
    ["Apple.COM.", true],
    ["ID.APPLE.COM", true],
    ["fakeapple.com", false],
    ["apple.com.evil.io", false],
    ["xn--fsqu00a.com", true],
    ["例子.com", true],
    ["sub.例子.com", true],
  ])("matchDomain 处理大小写、尾点与国际化域名：%j", (candidate, expected) => {
    const compiled = compileDomainList(["apple.com", "例子.com"]);
    expect(matchDomain(candidate, compiled) !== null).toBe(expected);
  });
});
