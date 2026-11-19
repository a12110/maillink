import { LINK_HIDDEN_PLACEHOLDER, presentedMailSchema, type ExtractedValues, type PresentConfig, type Redaction } from "@maillink/shared";
import { describe, expect, it } from "vitest";
import { extractForGroup } from "../../src/rules/extract";
import type { MailFacts } from "../../src/rules/facts";
import { maskAddress } from "../../src/render/mask";
import { lockPresentedMail, presentDetail, presentListItem, viewHasDetail } from "../../src/render/present";
import { normalizeDisplayText } from "../../src/render/text";
import { compileOrThrow, makeConfig, makeFacts } from "../rules/helpers";

// 呈现（02 §4.1–§4.4，04 PresentedMail）。

function setup(present: Partial<PresentConfig>, facts: MailFacts = makeFacts()) {
  const compiled = compileOrThrow(makeConfig({ present }));
  const extracted: ExtractedValues = extractForGroup(compiled, facts, facts.code === null ? null : "builtin");
  return { presentation: compiled.presentation, facts, extracted };
}

function list(present: Partial<PresentConfig>, facts?: MailFacts) {
  const { presentation, facts: f, extracted } = setup(present, facts);
  const mail = presentListItem(presentation, f, extracted);
  presentedMailSchema.parse(mail);
  return mail;
}

describe("收件地址打码", () => {
  it.each([
    ["a@icloud.com", "***@icloud.com"],
    ["ab@icloud.com", "a***@icloud.com"],
    ["abc@icloud.com", "a***@icloud.com"],
    ["abcd@icloud.com", "ab***@icloud.com"],
    ["abcdefghij@icloud.com", "ab***@icloud.com"],
    ["名字很长@例子.com", "名字***@例子.com"],
    ["😀😀@x.com", "😀***@x.com"],
    ["@icloud.com", "***@icloud.com"],
    ["a@b@c.com", "a***@c.com"],
    ["no-at-sign", "***"],
  ])("%s → %s", (address, masked) => {
    expect(maskAddress(address)).toBe(masked);
  });
});

describe("字段可见性", () => {
  const facts = makeFacts({ sender: { addresses: ["noreply@tm.openai.com", "x@other.io"], domains: ["tm.openai.com", "other.io"], name: "OpenAI" } });
  it.each<[PresentConfig["sender"], MailFacts, unknown]>([
    ["full", facts, { address: "noreply@tm.openai.com", name: "OpenAI" }],
    ["domain", facts, { domain: "tm.openai.com" }],
    ["name", facts, { name: "OpenAI" }],
    ["hidden", facts, undefined],
    ["name", makeFacts({ sender: { name: null } }), undefined],
    ["name", makeFacts({ sender: { name: "" } }), undefined],
    ["full", makeFacts({ sender: { name: null } }), { address: "noreply@tm.openai.com" }],
    ["full", makeFacts({ sender: { addresses: [], domains: [], name: null } }), undefined],
    ["domain", makeFacts({ sender: { addresses: [], domains: ["only.example"] } }), { domain: "only.example" }],
  ])("sender=%s", (mode, f, expected) => {
    const mail = list({ sender: mode }, f);
    expect(mail.sender).toEqual(expected);
    if (expected === undefined) expect("sender" in mail).toBe(false);
  });

  it.each<[PresentConfig["recipient"], string | undefined]>([
    ["full", "alias123@icloud.com"],
    ["masked", "al***@icloud.com"],
    ["hidden", undefined],
  ])("recipient=%s", (mode, expected) => {
    const mail = list({ recipient: mode });
    expect(mail.recipient).toBe(expected);
    expect("recipient" in mail).toBe(expected !== undefined);
  });

  const withAttachments = makeFacts({ attachments: [{ name: "a.pdf", content_type: "application/pdf", size: 10 }, { name: "b.png", content_type: "image/png", size: 20 }] });
  it.each<[PresentConfig["attachments"], unknown]>([
    ["hidden", undefined],
    ["list", [{ index: 0, name: "a.pdf", size: 10, downloadable: false }, { index: 1, name: "b.png", size: 20, downloadable: false }]],
    ["download", [{ index: 0, name: "a.pdf", size: 10, downloadable: true }, { index: 1, name: "b.png", size: 20, downloadable: true }]],
  ])("attachments=%s", (mode, expected) => {
    const mail = list({ attachments: mode }, withAttachments);
    expect(mail.attachments).toEqual(expected);
    expect("attachments" in mail).toBe(expected !== undefined);
  });
});

describe("视图模式（02 §4.1）", () => {
  const facts = makeFacts({ attachments: [{ name: "a.pdf", content_type: "application/pdf", size: 10 }] });
  it.each<[PresentConfig["view"], Partial<PresentConfig>, string[]]>([
    ["full", {}, ["id", "received_at", "sender", "recipient", "subject", "snippet", "attachments"]],
    ["text", {}, ["id", "received_at", "sender", "recipient", "subject", "snippet", "attachments"]],
    ["text", { snippet: false }, ["id", "received_at", "sender", "recipient", "subject", "attachments"]],
    ["code_only", { links: "strip" }, ["id", "received_at", "sender", "recipient", "code"]],
    ["meta_only", {}, ["id", "received_at", "sender", "recipient", "subject"]],
  ])("%s 列表只含这些字段", (view, extra, keys) => {
    const mail = list({ view, ...extra }, facts);
    expect(Object.keys(mail).sort()).toEqual([...keys].sort());
  });

  it("code_only 同时显示验证码与登录链接（按 extract）", () => {
    const f = makeFacts({ links: ["https://auth.openai.com/magic?t=1"] });
    const mail = list({ view: "code_only", extract: ["code", "login_link"], links: { allow_domains: ["openai.com"] } }, f);
    expect(mail.code).toBe("123456");
    expect(mail.login_link).toBe("https://auth.openai.com/magic?t=1");
  });

  it("code_only 下没有可显示内容时直接抛错（调用方漏判 no_code）", () => {
    const { presentation, facts: f, extracted } = setup({ view: "code_only", links: "strip" }, makeFacts({ code: null }));
    expect(() => presentListItem(presentation, f, extracted)).toThrow(/no_code/u);
  });

  it.each<[PresentConfig["view"], boolean]>([
    ["full", true],
    ["text", true],
    ["code_only", false],
    ["meta_only", false],
  ])("viewHasDetail(%s) = %s", (view, expected) => {
    expect(viewHasDetail(view)).toBe(expected);
  });
});

describe("链接（02 §4.3）", () => {
  const body =
    "Sign in: https://auth.openai.com/magic?t=abc. Or www.openai.com/help, see help.openai.com/x and " +
    "https://openai.com.evil.io/phish (ftp://files.openai.com/f) mail me at someone@openai.com. Plain openai.com mention.";
  const facts = makeFacts({ subject: "Visit https://evil.example/s now", body });

  it("strip：主题与预览里的 URL 都换成占位文字，保留结尾标点，不动邮箱地址与无路径的域名", () => {
    const mail = list({ links: "strip", snippet: true }, facts);
    expect(mail.subject).toBe(`Visit ${LINK_HIDDEN_PLACEHOLDER} now`);
    expect(mail.snippet).toBe(
      `Sign in: ${LINK_HIDDEN_PLACEHOLDER}. Or ${LINK_HIDDEN_PLACEHOLDER}, see ${LINK_HIDDEN_PLACEHOLDER} and ` +
        `${LINK_HIDDEN_PLACEHOLDER} (${LINK_HIDDEN_PLACEHOLDER}) mail me at someone@openai.com. Plain openai.com mention.`,
    );
  });

  it("allow_domains：只保留允许域名（含子域名）的 http(s) 链接", () => {
    const mail = list({ links: { allow_domains: ["openai.com"] } }, facts);
    expect(mail.snippet).toBe(
      "Sign in: https://auth.openai.com/magic?t=abc. Or www.openai.com/help, see help.openai.com/x and " +
        `${LINK_HIDDEN_PLACEHOLDER} (${LINK_HIDDEN_PLACEHOLDER}) mail me at someone@openai.com. Plain openai.com mention.`,
    );
    expect(mail.subject).toBe(`Visit ${LINK_HIDDEN_PLACEHOLDER} now`);
  });

  it("keep：原样", () => {
    expect(list({ links: "keep" }, facts).snippet).toBe(body.slice(0, 200) + "…");
  });

  it.each<[string, string]>([
    ["evil.example:8080/x", `${LINK_HIDDEN_PLACEHOLDER}`],
    ["evil.example:8080", `${LINK_HIDDEN_PLACEHOLDER}`],
    ["192.168.1.10/admin", `${LINK_HIDDEN_PLACEHOLDER}`],
    ["10.0.0.1:8080/x.", `${LINK_HIDDEN_PLACEHOLDER}.`],
    ["evil.example", "evil.example"],
    ["192.168.1.10", "192.168.1.10"],
    ["a@10.0.0.1:25", "a@10.0.0.1:25"],
  ])("strip：带端口的主机与裸 IPv4 %s（裸域名 / 裸 IP 不处理，由前端不自动链接兜底）", (link, expected) => {
    expect(list({ links: "strip" }, makeFacts({ body: `go ${link}` })).snippet).toBe(`go ${expected}`);
  });

  it("allow_domains：带端口的允许域名保留，IPv4 去掉", () => {
    const f = makeFacts({ body: "a auth.openai.com:8443/x b 10.0.0.1:8080/x" });
    expect(list({ links: { allow_domains: ["openai.com"] } }, f).snippet).toBe(`a auth.openai.com:8443/x b ${LINK_HIDDEN_PLACEHOLDER}`);
  });

  it("兜底：解析阶段提取到但文本模式认不出的链接，按原文替换", () => {
    const f = makeFacts({ body: "Open openai-login:token/123 to continue", links: ["openai-login:token/123"] });
    expect(list({ links: "strip" }, f).snippet).toBe(`Open ${LINK_HIDDEN_PLACEHOLDER} to continue`);
  });
});

describe("脱敏（02 §4.4）", () => {
  const phone: Redaction = { name: "手机号", match: { type: "regex", pattern: "1\\d{10}" }, scope: ["subject", "body"], replace: "[手机号]" };
  const label: Redaction = { name: "标签", match: { type: "text", pattern: "手机号" }, scope: ["body"], replace: "PHONE" };

  it("按 redact 顺序依次替换（顺序不同结果不同）", () => {
    const facts = makeFacts({ body: "联系 13800138000" });
    expect(list({ redact: [phone, label] }, facts).snippet).toBe("联系 [PHONE]");
    expect(list({ redact: [label, phone] }, facts).snippet).toBe("联系 [手机号]");
  });

  it("scope 只作用于指定位置", () => {
    const facts = makeFacts({ subject: "手机号 13800138000", body: "手机号 13900139000" });
    const mail = list({ redact: [{ ...phone, scope: ["body"] }, label] }, facts);
    expect(mail.subject).toBe("手机号 13800138000");
    // 第二条作用在第一条的结果上：[手机号] 里的"手机号"也被替换
    expect(mail.snippet).toBe("PHONE [PHONE]");
  });

  it("全角数字、零宽字符不能绕过脱敏（先归一化再匹配）", () => {
    const facts = makeFacts({ body: "号码 １３８００１３８０００ 与 138\u200B0013\u200B8000" });
    expect(list({ redact: [phone] }, facts).snippet).toBe("号码 [手机号] 与 [手机号]");
  });

  it("文本脱敏不区分大小写，空格可匹配任意空白，替换文本里的 $& 按字面输出", () => {
    const secret: Redaction = { name: "s", match: { type: "text", pattern: "Secret  Word" }, scope: ["body"], replace: "$&-$1" };
    const facts = makeFacts({ body: "the SECRET word and secret\tword" });
    expect(list({ redact: [secret] }, facts).snippet).toBe("the $&-$1 and $&-$1");
  });

  it("预览先脱敏再截断：截断边界上的号码不会漏出一半", () => {
    const facts = makeFacts({ body: `${"x".repeat(195)} 13800138000 tail` });
    const snippet = list({ redact: [phone] }, facts).snippet ?? "";
    expect(snippet).not.toMatch(/\d{4}/u);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("链接先处理、再脱敏", () => {
    const urlRedaction: Redaction = { name: "u", match: { type: "text", pattern: "链接已隐藏" }, scope: ["body"], replace: "LINK" };
    const facts = makeFacts({ body: "go https://evil.example/x now" });
    expect(list({ links: "strip", redact: [urlRedaction] }, facts).snippet).toBe("go [LINK] now");
  });
});

describe("详情", () => {
  it("text 视图：只有纯文本；保留换行，链接与脱敏照样处理；不含 html", async () => {
    const phone: Redaction = { name: "p", match: { type: "regex", pattern: "1\\d{10}" }, scope: ["body"], replace: "***" };
    const { presentation, facts, extracted } = setup({ view: "text", links: "strip", redact: [phone] });
    const mail = await presentDetail(presentation, facts, extracted, {
      text: "Hi,\r\n\r\n\r\n  Call ＋86 13800138000   now:\nhttps://evil.example/x\u200B",
      html: "<p>ignored</p>",
    });
    expect(mail.text).toBe(`Hi,\n\nCall +86 *** now:\n${LINK_HIDDEN_PLACEHOLDER}`);
    expect("html" in mail).toBe(false);
    presentedMailSchema.parse(mail);
  });

  it("full 视图：带清洗后的完整 HTML 文档（含 CSP）与纯文本", async () => {
    const { presentation, facts, extracted } = setup({ view: "full" });
    const mail = await presentDetail(presentation, facts, extracted, {
      text: "plain",
      html: '<p onclick="x()">Hello</p><script>alert(1)</script><img src="https://t.example/p.gif">',
    });
    expect(mail.text).toBe("plain");
    expect(mail.html).toBe(
      `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"></head><body><p>Hello</p><img>`,
    );
  });

  it("full 视图但邮件没有 HTML：只有纯文本", async () => {
    const { presentation, facts, extracted } = setup({ view: "full" });
    const mail = await presentDetail(presentation, facts, extracted, { text: "plain", html: null });
    expect("html" in mail).toBe(false);
  });

  it.each<PresentConfig["view"]>(["code_only", "meta_only"])("%s 没有详情，调用即抛错", async (view) => {
    const { presentation, facts, extracted } = setup({ view, links: "strip" });
    await expect(presentDetail(presentation, facts, extracted, { text: "x", html: null })).rejects.toThrow(/没有详情/u);
  });

  it("展示用归一化保留段落、去掉不可见字符与全角", () => {
    expect(normalizeDisplayText("\uFEFF Ａ\t\tb \n\n\n\nc\u00AD ")).toBe("A b\n\nc");
  });
});

describe("click 取码：锁定状态", () => {
  it("只留 id、时间、发件人、收件地址，不含主题、预览、验证码、链接、附件", () => {
    const mail = list({ view: "code_only", links: "strip", recipient: "masked", sender: "domain" });
    expect(lockPresentedMail(mail)).toEqual({
      id: 1,
      received_at: mail.received_at,
      sender: { domain: "tm.openai.com" },
      recipient: "al***@icloud.com",
      locked: true,
    });
  });
});
