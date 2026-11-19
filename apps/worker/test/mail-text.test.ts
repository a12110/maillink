import { describe, expect, it } from "vitest";
import { MAIL_LINKS_MAX_COUNT, MAIL_LINK_MAX_LENGTH } from "../src/constants";
import {
  decodeHtmlEntities,
  extractHtml,
  extractLinks,
  normalizeDisplayText,
  normalizeText,
  truncateUtf8,
} from "../src/mail-parse";

describe("normalizeText", () => {
  it("NFKC：全角字符与兼容字符折叠", () => {
    expect(normalizeText("ＡＢＣ１２３ ｱｲｳ ㈱")).toBe("ABC123 アイウ (株)");
    expect(normalizeText("ﬁne")).toBe("fine");
  });

  it("去掉零宽字符、软连字符与双向控制符", () => {
    expect(normalizeText("re\u200Bset\u200C pass\u200Dword")).toBe("reset password");
    expect(normalizeText("pass\u00ADword")).toBe("password");
    expect(normalizeText("\uFEFFhello\u2060world")).toBe("helloworld");
    expect(normalizeText("a\u202Eb")).toBe("ab");
  });

  it("合并所有空白（含换行、制表、NBSP、全角空格）并去首尾", () => {
    expect(normalizeText("  a \n\n b\t\tc\u00A0d\u3000e \r\n")).toBe("a b c d e");
  });

  it("零宽字符不能用来绕开关键词", () => {
    expect(normalizeText("重\u200B设\u200B密\u200B码").includes("重设密码")).toBe(true);
  });
});

describe("normalizeDisplayText", () => {
  it("保留换行；每行内部合并空白；连续空行最多一个；统一换行符", () => {
    expect(normalizeDisplayText("a  b\t c\r\nd \n\n\n\n e\rf\u2028g")).toBe("a b c\nd\n\ne\nf\ng");
  });

  it("NFKC 与去不可见字符", () => {
    expect(normalizeDisplayText("Ｈｅｌｌｏ\u200B world\n\u00ADx")).toBe("Hello world\nx");
  });

  it("首尾空白与空行被去掉", () => {
    expect(normalizeDisplayText("\n\n  hi  \n\n")).toBe("hi");
  });
});

describe("truncateUtf8", () => {
  it("未超限时原样返回", () => {
    expect(truncateUtf8("hello", 10)).toEqual({ text: "hello", truncated: false });
    expect(truncateUtf8("héllo", 6)).toEqual({ text: "héllo", truncated: false });
  });

  it("按字节截断，结果不超限", () => {
    const result = truncateUtf8("a".repeat(100), 10);
    expect(result).toEqual({ text: "a".repeat(10), truncated: true });
  });

  it("不切坏多字节字符：2 / 3 / 4 字节字符落在截断点上", () => {
    for (const char of ["é", "中", "😀"]) {
      const bytes = new TextEncoder().encode(char).length;
      for (let cut = 1; cut < bytes + 3; cut++) {
        const text = `ab${char}${char}`;
        const result = truncateUtf8(text, cut);
        expect(new TextEncoder().encode(result.text).length).toBeLessThanOrEqual(cut);
        // 没有替换字符 U+FFFD，说明没有产生残缺的 UTF-8
        expect(result.text.includes("\uFFFD")).toBe(false);
        expect(text.startsWith(result.text)).toBe(true);
      }
    }
  });

  it("恰好在字符边界时保留完整字符", () => {
    expect(truncateUtf8("中文中文", 6)).toEqual({ text: "中文", truncated: true });
    expect(truncateUtf8("中文中文", 7)).toEqual({ text: "中文", truncated: true });
  });
});

describe("html → 文本", () => {
  it("去掉 script / style 的内容，保留可见文字（title 文字保留，head 本身不跳过）", async () => {
    const { text } = await extractHtml(
      "<html><head><title>T</title><style>.a{color:red}</style></head><body><script>var secret=1</script><h1>Hello</h1><p>World</p><style>x{}</style></body></html>",
    );
    const normalized = normalizeText(text);
    expect(normalized).toBe("T Hello World");
    expect(normalized).not.toMatch(/secret|color/);
  });

  it("对抗：省略 </head> 时，head 里的 div 文字与后面的正文都在", async () => {
    const { text, hrefs } = await extractHtml('<html><head><div>secret</div><a href="https://a.example/x">l</a><body><p>after head</p>');
    expect(normalizeText(text)).toBe("secret l after head");
    expect(hrefs).toEqual(["https://a.example/x"]);
  });

  it("顶层裸文字（不在任何元素里）也能取到", async () => {
    expect(normalizeText((await extractHtml("Your code 123<br>")).text)).toBe("Your code 123");
    expect(normalizeText((await extractHtml("plain fragment, no tags")).text)).toBe("plain fragment, no tags");
    expect(normalizeText((await extractHtml("before<p>inside</p>after")).text)).toBe("before inside after");
  });

  it("没有关闭的 <script> / <style> 会吞掉其后的内容（与浏览器一致），但之前的文字保留", async () => {
    expect(normalizeText((await extractHtml("keep<script>var x = 1; never closed")).text)).toBe("keep");
  });

  it("块级标签输出换行，<br> 输出换行，单元格用空格", async () => {
    const { text } = await extractHtml("<div>a</div><p>b<br>c</p><table><tr><td>d</td><td>e</td></tr></table>");
    expect(normalizeDisplayText(text)).toBe("a\nb\nc\nd e");
  });

  it("块级标签两侧补空格，行内标签不拆词", async () => {
    const { text } = await extractHtml("<div>one</div><div>two</div><p>12<b>34</b></p>");
    expect(normalizeText(text)).toBe("one two 1234");
  });

  it("解码实体，包括数字与十六进制", async () => {
    const { text } = await extractHtml("<p>Tom &amp; Jerry &lt;3 &#8364;5 &#x4E2D;&nbsp;文</p>");
    expect(normalizeText(text)).toBe("Tom & Jerry <3 €5 中 文");
  });

  it("收集 <a href>（含实体）", async () => {
    const { hrefs } = await extractHtml(
      '<a href="https://a.example/x?a=1&amp;b=2">x</a><script><a href="https://hidden.example">no</a></script>',
    );
    expect(hrefs).toEqual(["https://a.example/x?a=1&b=2"]);
  });

  it("decodeHtmlEntities：未知实体与非法码点原样保留", () => {
    expect(decodeHtmlEntities("&foo; &#0; &#xD800; &#99999999;")).toBe("&foo; &#0; &#xD800; &#99999999;");
  });
});

describe("链接", () => {
  it("提取正文 URL，去重，去掉结尾标点与 CJK 标点", () => {
    const { links } = extractLinks(
      "see https://a.example/x. and (https://b.example/y), https://a.example/x 以及https://c.example/z。后面",
      [],
    );
    expect(links).toEqual(["https://a.example/x", "https://b.example/y", "https://c.example/z"]);
  });

  it("href 在前、正文在后；只留 http(s)", () => {
    const { links } = extractLinks("visit https://text.example/p", ["https://href.example/h", "javascript:alert(1)", "mailto:a@b.c"]);
    expect(links).toEqual(["https://href.example/h", "https://text.example/p"]);
  });

  it("数量上限：超出的丢弃", () => {
    const body = Array.from({ length: MAIL_LINKS_MAX_COUNT + 20 }, (_, i) => `https://e${i}.example/`).join(" ");
    const { links, domains } = extractLinks(body, []);
    expect(links).toHaveLength(MAIL_LINKS_MAX_COUNT);
    expect(links[0]).toBe("https://e0.example/");
    // 域名不受数量上限影响：超出上限的链接域名也在
    expect(domains).toHaveLength(MAIL_LINKS_MAX_COUNT + 20);
    expect(domains).toContain(`e${MAIL_LINKS_MAX_COUNT + 19}.example`);
  });

  it("对抗：先塞满无害链接，恶意链接排在第 51 个，域名仍然可见", () => {
    const harmless = Array.from({ length: MAIL_LINKS_MAX_COUNT }, (_, i) => `https://ok${i}.example/`).join(" ");
    const { links, domains } = extractLinks(`${harmless} https://evil.example/login`, []);
    expect(links).not.toContain("https://evil.example/login");
    expect(domains).toContain("evil.example");
  });

  it("对抗：把恶意链接补长超过上限，域名仍然可见", () => {
    const evil = `https://Evil.Example/${"a".repeat(MAIL_LINK_MAX_LENGTH)}`;
    const { links, domains } = extractLinks(`click ${evil}`, []);
    expect(links).toEqual([]);
    expect(domains).toEqual(["evil.example"]);
  });

  it("对抗：超长链接来自 href 时同样保留域名", () => {
    const { links, domains } = extractLinks("", [`https://evil.example/${"b".repeat(MAIL_LINK_MAX_LENGTH)}`]);
    expect(links).toEqual([]);
    expect(domains).toEqual(["evil.example"]);
  });

  it("长度上限：超长链接丢弃，恰好等于上限的保留", () => {
    const prefix = "https://long.example/";
    const ok = prefix + "a".repeat(MAIL_LINK_MAX_LENGTH - prefix.length);
    const tooLong = ok + "b";
    expect(extractLinks(`${ok} ${tooLong}`, []).links).toEqual([ok]);
  });

  it("domains：全小写、去重、去端口", () => {
    const { domains } = extractLinks("https://A.Example/x http://a.example/y https://b.example:8443/z", []);
    expect(domains).toEqual(["a.example", "b.example"]);
  });
});
