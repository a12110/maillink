import { describe, expect, it } from "vitest";
import { BODY_INDEX_CAP_BYTES } from "../src/constants";
import { MailParseError, hmeSender, parseHmeFields, parseMail, parseMime, rowCodeSource, rowToFacts } from "../src/mail-parse";
import type { MailFacts, MailIndexRow } from "../src/mail-parse";
import { buildLargeMail, LARGE_MAIL_CODE, LARGE_MAIL_TAIL_MARKER } from "./fixtures/build-large-mail";
import { buildMail } from "./access-helpers";
import { candidateOf, fixture } from "./mail-helpers";

async function parseFixture(name: string, overrides: Parameters<typeof candidateOf>[0] = { id: 1 }, metadata: string | null = null) {
  const candidate = candidateOf(overrides);
  return await parseMail({ candidate, raw: fixture(name), metadata });
}

describe("HME 发件人", () => {
  it("p= 等于收件地址：From 与 s= 都进入候选", async () => {
    const { facts, from_address } = await parseFixture("icloud-hme-forward.eml", {
      id: 1,
      address: "mailbox@example.com",
      to_address: "hme.alias.7k2@icloud.com",
    });
    expect(facts.recipient).toBe("hme.alias.7k2@icloud.com");
    // 样本里 From 与 s= 是同一个地址，去重后只有一个
    expect(facts.sender.addresses).toEqual(["no-reply@accounts.example.net"]);
    expect(from_address).toBe("no-reply@accounts.example.net");
  });

  it("p= 等于收件地址（不区分大小写）：s= 与 From 不同时两者都保留", () => {
    const headers = [{ key: "x-icloud-hme", value: "p=Alias@ICLOUD.com; d=example.net; f=box@example.com; r=to; s=Orig.Sender@Example.NET" }];
    expect(hmeSender(headers, "alias@icloud.com")).toBe("orig.sender@example.net");
  });

  it("p= 与收件地址不一致：不采用 s=", async () => {
    const { facts } = await parseFixture("icloud-hme-mismatch.eml", {
      id: 15,
      address: "mailbox@example.com",
      to_address: "hme.alias.7k2@icloud.com",
    });
    expect(facts.sender.addresses).toEqual(["no-reply@accounts.example.net"]);
    expect(facts.sender.domains).toEqual(["accounts.example.net"]);
    expect(JSON.stringify(facts)).not.toContain("spoofed@evil.example.net");
  });

  it("From 与 s= 不同的 HME 邮件：候选里两个都在，展示用 From，域名去重", async () => {
    const raw = fixture("icloud-hme-forward.eml").replace(
      "s=no-reply@accounts.example.net",
      "s=orig@service.example.org",
    );
    const { facts, from_address } = await parseMail({
      candidate: candidateOf({ id: 1, address: "mailbox@example.com", to_address: "hme.alias.7k2@icloud.com" }),
      raw,
      metadata: null,
    });
    expect(facts.sender.addresses).toEqual(["no-reply@accounts.example.net", "orig@service.example.org"]);
    expect(facts.sender.domains).toEqual(["accounts.example.net", "service.example.org"]);
    expect(from_address).toBe("no-reply@accounts.example.net");
  });

  it("没有 HME 头、头里没有 p= 或 s=、%40 转义", () => {
    expect(hmeSender([], "a@b.c")).toBeNull();
    expect(hmeSender([{ key: "x-icloud-hme", value: "d=example.net" }], "a@b.c")).toBeNull();
    expect(hmeSender([{ key: "x-icloud-hme", value: "p=a%40b.c; s=x@y.z" }], "a@b.c")).toBe("x@y.z");
    expect(hmeSender([{ key: "x-icloud-hme", value: "p=a@b.c" }], "a@b.c")).toBeNull();
    // s= 带引号
    expect(hmeSender([{ key: "x-icloud-hme", value: 'p=a@b.c; s="Quoted@Y.Z"' }], "a@b.c")).toBe("quoted@y.z");
    expect(parseHmeFields("p=1; P=2; junk; s=3")).toEqual({ p: "1", s: "3" });
  });
});

describe("parseMail：样本", () => {
  it("验证码邮件：facts 各字段", async () => {
    const { facts } = await parseFixture("verification-code.eml", { id: 2, received_at: 1_700_000_000, source: "noreply@login.example.org" });
    expect(facts).toMatchObject({
      mail_id: 2,
      received_at: 1_700_000_000,
      recipient: "box@example.com",
      subject: expect.stringContaining("登录验证码"),
      body_truncated: false,
      links: [],
      link_domains: [],
      attachments: [],
      has_html: false,
      category: "verification",
    });
    expect(facts.sender.envelope).toBe("noreply@login.example.org");
    expect(facts.raw_size).toBe(new TextEncoder().encode(fixture("verification-code.eml")).length);
    expect(facts.code).toMatch(/^\d{6}$/);
  });

  it("中文 / 日文验证码邮件：RFC 2047 主题与发件人名被解码", async () => {
    const zh = await parseFixture("verification-code-zh.eml", { id: 6 });
    expect(zh.facts.subject).toBe("【Example】您的登录验证码");
    expect(zh.facts.sender.name).toBe("Example 账号");
    expect(zh.facts.code).toBe("704512");
    expect(zh.facts.category).toBe("verification");
    const ja = await parseFixture("verification-code-ja.eml", { id: 7 });
    expect(ja.facts.code).toBe("538204");
    expect(ja.facts.category).toBe("verification");
  });

  it("重设密码的验证码：提取到验证码，但分类是 password_reset", async () => {
    const { facts } = await parseFixture("password-reset-code.eml", { id: 8 });
    expect(facts.code).toBe("639201");
    expect(facts.category).toBe("password_reset");
  });

  it("更换邮箱 / 安全通知 / 账单 / 重设密码链接邮件的分类", async () => {
    expect((await parseFixture("email-change.eml", { id: 9 })).facts.category).toBe("email_change");
    expect((await parseFixture("security-notice.eml", { id: 10 })).facts.category).toBe("security_change");
    expect((await parseFixture("billing-receipt.eml", { id: 11 })).facts.category).toBe("billing");
    const reset = (await parseFixture("password-reset.eml", { id: 3 })).facts;
    expect(reset.category).toBe("password_reset");
    expect(reset.links).toEqual(["https://service.example.com/reset?token=synthetic-token-not-real"]);
    expect(reset.link_domains).toEqual(["service.example.com"]);
  });

  it("掩码尾号样本：提取 908172，不是 1234", async () => {
    expect((await parseFixture("masked-code.eml", { id: 21 })).facts.code).toBe("908172");
  });

  it("多行样本：展示正文保留换行，判定用 body 是单行", async () => {
    const parsed = await parseFixture("multiline-text.eml", { id: 20 });
    expect(parsed.display_body).toBe("Hi team,\n\nNotes from today:\n- item one\n- item two\n\nThanks,\nExample");
    expect(parsed.facts.body).toBe("Hi team, Notes from today: - item one - item two Thanks, Example");
  });

  it("数字带空格的验证码输出去掉分隔符", async () => {
    expect((await parseFixture("verification-code-spaced.eml", { id: 12 })).facts.code).toBe("123456");
  });

  it("含年份与金额干扰项、没有验证码的邮件：code 为空", async () => {
    const { facts } = await parseFixture("no-code-distractors.eml", { id: 13 });
    expect(facts.code).toBeNull();
    expect(facts.category).toBe("other");
  });

  it("ai_extract 优先于内置提取，并记录来源", async () => {
    const metadata = JSON.stringify({ ai_extract: { type: "auth_code", result: "445566" } });
    const withAi = await parseFixture("ai-extract-priority.eml", { id: 16 }, metadata);
    expect(withAi.facts.code).toBe("445566");
    expect(withAi.code_source).toBe("ai_extract");
    const builtin = await parseFixture("ai-extract-priority.eml", { id: 16 });
    expect(builtin.facts.code).toBe("112233");
    expect(builtin.code_source).toBe("builtin");
    expect((await parseFixture("password-reset.eml", { id: 3 })).code_source).toBeNull();
  });

  it("html 邮件：text 与 html 内容拼接；script 内容不进正文；href 进链接；has_html", async () => {
    const { facts } = await parseFixture("html-newsletter.eml", { id: 4 });
    expect(facts.has_html).toBe(true);
    expect(facts.body).toContain("Example Weekly");
    expect(facts.body).toContain("Five things worth reading");
    expect(facts.body).not.toContain("synthetic = ");
    expect(facts.links).toContain("https://newsletter.example.com/issues/42");
  });

  it("纯文本与 HTML 内容不同：两者都进 body（防止绕过黑名单）", async () => {
    const raw = [
      "From: a@example.org",
      "To: box@example.com",
      "Subject: x",
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="b"',
      "",
      "--b",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "harmless text part",
      "--b",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>reset your password now</p>",
      "--b--",
      "",
    ].join("\r\n");
    const { facts } = await parseMail({ candidate: candidateOf({ id: 1 }), raw, metadata: null });
    expect(facts.body).toContain("harmless text part");
    expect(facts.body).toContain("reset your password now");
    expect(facts.category).toBe("password_reset");
  });

  it("纯文本与 HTML 内容相同时只保留一份", async () => {
    const raw = [
      "From: a@example.org", "To: box@example.com", "Subject: x", "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="b"', "",
      "--b", "Content-Type: text/plain", "", "same words", "--b", "Content-Type: text/html", "", "<p>same words</p>", "--b--", "",
    ].join("\r\n");
    const { facts } = await parseMail({ candidate: candidateOf({ id: 1 }), raw, metadata: null });
    expect(facts.body).toBe("same words");
  });

  it("附件：只记名称、类型、大小；解码 RFC 2231 文件名", async () => {
    const { facts } = await parseFixture("attachment.eml", { id: 17 });
    expect(facts.attachments).toEqual([{ name: "报告.txt", content_type: "text/plain", size: expect.any(Number) }]);
    expect(facts.attachments[0]?.size).toBeGreaterThan(0);
    const email = await parseMime(fixture("attachment.eml"));
    expect(new TextDecoder().decode(email.attachments[0]?.content as ArrayBuffer)).toContain("合成附件内容");
  });

  it("正文超过 32 KB：截断、标记，验证码仍从完整正文里提取", async () => {
    const { facts } = await parseMail({ candidate: candidateOf({ id: 14 }), raw: buildLargeMail(), metadata: null });
    expect(facts.body_truncated).toBe(true);
    expect(new TextEncoder().encode(facts.body).length).toBeLessThanOrEqual(BODY_INDEX_CAP_BYTES);
    expect(facts.body).not.toContain(LARGE_MAIL_TAIL_MARKER);
    expect(facts.code).toBe(LARGE_MAIL_CODE);
    expect(facts.raw_size).toBeGreaterThan(BODY_INDEX_CAP_BYTES);
  });

  it("对抗：51 个以上链接、超长链接：links 被截断，link_domains 仍含全部域名并写进索引列", async () => {
    const harmless = Array.from({ length: 55 }, (_, i) => `https://ok${i}.example/`).join(" ");
    const longEvil = `https://evil.example/${"a".repeat(3000)}`;
    const raw = `From: a@example.org\r\nTo: box@example.com\r\nSubject: links\r\n\r\n${harmless} ${longEvil}`;
    const { facts } = await parseMail({ candidate: candidateOf({ id: 1 }), raw, metadata: null });
    expect(facts.links).toHaveLength(50);
    expect(facts.link_domains).toHaveLength(56);
    expect(facts.link_domains).toContain("evil.example");
  });

  it("展示正文不受 32 KB 索引上限约束（有自己的上限），判定用 body 仍被截断", async () => {
    const parsed = await parseMail({ candidate: candidateOf({ id: 14 }), raw: buildLargeMail(), metadata: null });
    expect(parsed.facts.body_truncated).toBe(true);
    expect(parsed.display_truncated).toBe(false);
    expect(parsed.display_body).toContain(LARGE_MAIL_TAIL_MARKER);
    expect(new TextEncoder().encode(parsed.display_body).length).toBeGreaterThan(BODY_INDEX_CAP_BYTES);
  });

  it("展示正文：多行纯文本保留换行；判定用 body 仍是单行", async () => {
    const raw = "From: a@example.org\r\nTo: box@example.com\r\nSubject: x\r\n\r\nline one\r\nline  two\r\n\r\n\r\n\r\nline three\r\n";
    const parsed = await parseMail({ candidate: candidateOf({ id: 1 }), raw, metadata: null });
    expect(parsed.display_body).toBe("line one\nline two\n\nline three");
    expect(parsed.facts.body).toBe("line one line two line three");
    expect(parsed.facts.body).not.toContain("\n");
  });

  it("展示正文：HTML 段落与 <br> 保留换行，script/style 内容不进来", async () => {
    const raw = [
      "From: a@example.org", "To: box@example.com", "Subject: x", "MIME-Version: 1.0", "Content-Type: text/html; charset=utf-8", "",
      "<style>.a{color:red}</style><h1>Title</h1><p>first para</p><p>second<br>line</p><script>evil()</script><div>tail</div>", "",
    ].join("\r\n");
    const parsed = await parseMail({ candidate: candidateOf({ id: 1 }), raw, metadata: null });
    expect(parsed.display_body).toBe("Title\nfirst para\nsecond\nline\ntail");
    expect(parsed.facts.body).toBe("Title first para second line tail");
  });

  it("展示正文：text 与 html 内容不同时用空行隔开", async () => {
    const raw = [
      "From: a@example.org", "To: box@example.com", "Subject: x", "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="b"', "",
      "--b", "Content-Type: text/plain", "", "plain\r\npart", "--b", "Content-Type: text/html", "", "<p>html part</p>", "--b--", "",
    ].join("\r\n");
    const parsed = await parseMail({ candidate: candidateOf({ id: 1 }), raw, metadata: null });
    expect(parsed.display_body).toBe("plain\npart\n\nhtml part");
    expect(parsed.facts.body).toBe("plain part html part");
  });

  it("对抗：HTML 里省略 </head>、顶层裸文字：正文与链接不丢", async () => {
    const raw = [
      "From: a@example.org", "To: box@example.com", "Subject: x", "MIME-Version: 1.0", "Content-Type: text/html; charset=utf-8", "",
      '<html><head><title>T</title><div>secret reset your password</div><a href="https://evil.example/x">go</a>', "",
    ].join("\r\n");
    const { facts } = await parseMail({ candidate: candidateOf({ id: 1 }), raw, metadata: null });
    expect(facts.body).toContain("secret reset your password");
    expect(facts.link_domains).toContain("evil.example");
    expect(facts.category).toBe("password_reset");
  });

});

describe("parseMail：失败", () => {
  it("畸形原文（没有邮件头）：抛 MailParseError", async () => {
    await expect(parseMail({ candidate: candidateOf({ id: 18 }), raw: fixture("malformed.eml"), metadata: null })).rejects.toBeInstanceOf(
      MailParseError,
    );
  });

  it("空字符串：抛 MailParseError", async () => {
    await expect(parseMime("")).rejects.toBeInstanceOf(MailParseError);
  });

  it("MIME 嵌套过深：抛 MailParseError 而不是把请求搞挂", async () => {
    let raw = "From: a@example.org\r\nSubject: deep\r\nMIME-Version: 1.0\r\n";
    const depth = 40;
    for (let i = 0; i < depth; i++) raw += `Content-Type: multipart/mixed; boundary="b${i}"\r\n\r\n--b${i}\r\n`;
    raw += "Content-Type: text/plain\r\n\r\nx\r\n";
    await expect(parseMime(raw)).rejects.toBeInstanceOf(MailParseError);
  });
});

describe("rowToFacts", () => {
  const okRow: MailIndexRow = {
    mail_id: 5, message_id: "<m>", received_at: 10, recipient: "a@b.c",
    sender_address: '["x@y.z"]', sender_domain: '["y.z"]', sender_name: "X", sender_envelope: "env@y.z",
    from_address: "x@y.z", subject: "S", body_text: "B", body_truncated: 1,
    links: '["https://l.example/a"]', link_domains: '["l.example","hidden.example"]',
    attachments: '[{"name":"f","content_type":"text/plain","size":3}]',
    code: "123456", code_source: "builtin", category: "billing", raw_size: 99, has_html: 1,
    parse_status: "ok", parse_error: null, parser_version: 1, indexed_at: 11,
  };

  it("索引行的 JSON 列还原成 facts；link_domains 直接读列（不由 links 重新派生）", () => {
    const facts: MailFacts = rowToFacts(okRow);
    expect(facts).toEqual({
      mail_id: 5, received_at: 10, recipient: "a@b.c",
      sender: { addresses: ["x@y.z"], domains: ["y.z"], name: "X", envelope: "env@y.z" },
      subject: "S", body: "B", body_truncated: true, links: ["https://l.example/a"],
      link_domains: ["l.example", "hidden.example"],
      attachments: [{ name: "f", content_type: "text/plain", size: 3 }], code: "123456", category: "billing",
      raw_size: 99, has_html: true,
    });
  });

  it("失败行：抛错而不是返回空 facts（空 facts 会让 deny 规则失败开放）", () => {
    const failed: MailIndexRow = {
      ...okRow, sender_address: "[]", sender_domain: "[]", subject: null, body_text: null, body_truncated: 0,
      links: "[]", link_domains: "[]", attachments: "[]", code: null, code_source: null, category: null,
      raw_size: null, has_html: null, parse_status: "failed", parse_error: "boom",
    };
    expect(() => rowToFacts(failed)).toThrow(/boom/);
  });

  it("ok 行缺 link_domains（旧版本写的行）：抛错，不当作空", () => {
    expect(() => rowToFacts({ ...okRow, link_domains: null })).toThrow(/link_domains/);
  });

  it("JSON 列被改坏：抛错而不是当成空", () => {
    expect(() => rowToFacts({ ...okRow, sender_address: "{oops" })).toThrow(/sender_address/);
  });

  it("rowCodeSource：与 code 一致才返回；不一致或取值未知抛错", () => {
    expect(rowCodeSource(okRow)).toBe("builtin");
    expect(rowCodeSource({ ...okRow, code: null, code_source: null })).toBeNull();
    expect(() => rowCodeSource({ ...okRow, code_source: null })).toThrow(/code_source/);
    expect(() => rowCodeSource({ ...okRow, code: null })).toThrow(/code_source/);
    expect(() => rowCodeSource({ ...okRow, code_source: "magic" as never })).toThrow(/code_source/);
  });
});

describe("HTML 部分无法解析", () => {
  it("lol-html 放弃解析的 HTML：抛 MailParseError（整封按解析失败处理，不退回只用纯文本）", async () => {
    const raw = buildMail({ text: "plain", html: "<select><style>p{}</style></select>" });
    await expect(parseMail({ candidate: candidateOf({ id: 1 }), raw, metadata: null })).rejects.toBeInstanceOf(MailParseError);
  });
});
