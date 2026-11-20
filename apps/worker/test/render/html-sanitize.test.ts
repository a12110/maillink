import { buildMailCsp, buildMailCspMetaTag, wrapMailHtmlDocument } from "@maillink/shared";
import { describe, expect, it } from "vitest";
import { compileDomainList } from "../../src/rules/domains";
import { HtmlSanitizeError, sanitizeEmailHtml, type HtmlSanitizeOptions } from "../../src/render/html-sanitize";
import { classifyUrl, decodeHtmlEntities } from "../../src/render/html-url";

// HTML 清洗（02 §4.5 第 1 条）的 XSS 向量与远程资源处理。

const KEEP: HtmlSanitizeOptions = { links: "keep", allowDomains: null, remoteImages: "block" };
const sanitize = (html: string, options: HtmlSanitizeOptions = KEEP) => sanitizeEmailHtml(html, options);

/** 清洗后不应出现的东西（大小写不敏感） */
const DANGEROUS =
  /<\s*(script|iframe|frame|object|embed|applet|form|input|button|textarea|meta|base|link|svg|math|noscript|template|audio|video)\b|javascript:|vbscript:|data:text|\son[a-z]+\s*=|srcdoc|formaction|expression\s*\(|xlink:href|ping=/iu;

describe("XSS 向量", () => {
  it.each<[string, string, string[]]>([
    ["script 标签", "<p>hi</p><script>alert(1)</script><p>ok</p>", ["<p>hi</p>", "<p>ok</p>"]],
    ["大写 SCRIPT", "<SCRIPT>alert(1)</SCRIPT>ok", ["ok"]],
    ["img onerror", '<img src=x onerror="alert(1)" alt="a">', ['alt="a"']],
    ["大写属性名 ONERROR", "<IMG SRC=x ONERROR=alert(1)>", ["<IMG"]],
    ["href 大小写混写的 javascript:", '<a href="JaVaScRiPt:alert(1)">x</a>', ["<a>x</a>"]],
    ["十进制实体编码的 javascript:", '<a href="&#106;avascript:alert(1)">x</a>', [">x</a>"]],
    ["十六进制实体与冒号实体", '<a href="&#x6A;avascript&#x3A;alert(1)">x</a>', [">x</a>"]],
    ["无分号、前导零的实体", '<a href="&#0000106&#0000097vascript:alert(1)">x</a>', [">x</a>"]],
    ["命名实体 &colon;", '<a href="javascript&colon;alert(1)">x</a>', [">x</a>"]],
    ["实体编码的制表符", '<a href="java&#9;script:alert(1)">x</a>', [">x</a>"]],
    ["原始换行插在协议中", '<a href="java\nscript:alert(1)">x</a>', [">x</a>"]],
    ["前导空白与控制字符", '<a href=" \u0001javascript:alert(1)">x</a>', [">x</a>"]],
    ["实体编码中间字母", '<a href="javas&#99;ript:alert(1)">x</a>', [">x</a>"]],
    ["vbscript:", '<a href="vbscript:msgbox(1)">x</a>', [">x</a>"]],
    ["data:text/html 链接", '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', [">x</a>"]],
    ["svg onload", "<svg onload=alert(1)><circle r=1 /></svg><p>after</p>", ["<p>after</p>"]],
    ["svg 里的 xlink:href 与 SMIL", '<svg><a xlink:href="javascript:alert(1)"><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg>', []],
    ["math 命名空间", '<math><mtext><a href="javascript:alert(1)">x</a></mtext></math>', []],
    ["iframe srcdoc", '<iframe srcdoc="<script>alert(1)</script>"></iframe><p>t</p>', ["<p>t</p>"]],
    ["form 与 formaction", '<form action="https://evil.example"><input name=p><button formaction="javascript:alert(1)">go</button></form>ok', ["ok"]],
    ["meta refresh", '<meta http-equiv="refresh" content="0;url=javascript:alert(1)"><p>x</p>', ["<p>x</p>"]],
    ["base href", '<base href="https://evil.example/"><a href="https://ok.example/">x</a>', ['href="https://ok.example/"']],
    ["link stylesheet", '<link rel="stylesheet" href="https://evil.example/x.css"><p>x</p>', ["<p>x</p>"]],
    ["object 与 embed", '<object data="javascript:alert(1)"></object><embed src="javascript:alert(1)"><p>x</p>', ["<p>x</p>"]],
    ["noscript（lol-html 与无脚本浏览器解析不一致）", "<noscript><img src=x onerror=alert(1)></noscript><p>x</p>", ["<p>x</p>"]],
    ["条件注释里的脚本", "<!--[if mso]><script>alert(1)</script><![endif]--><p>x</p>", ["<p>x</p>"]],
    ["details ontoggle / body onload", '<body onload="alert(1)"><details open ontoggle=alert(1)>x</details></body>', ["<details open>"]],
    ["video / audio 与 source onerror", "<video><source src=x onerror=alert(1)></video><audio src=https://t.example/a.mp3></audio>ok", ["ok"]],
    ["textarea 里的标签", "<textarea><img src=x onerror=alert(1)></textarea>ok", ["ok"]],

    ["style 属性 expression()", '<div style="width:expression(alert(1))">x</div>', ["<div>x</div>"]],
    ["style 属性 url(javascript:)", '<div style="background:url(javascript:alert(1))">x</div>', ["<div>x</div>"]],
    ["style 属性里实体编码的 javascript:", '<div style="background:url(&#106;avascript:alert(1))">x</div>', ["<div>x</div>"]],
    ["style 属性 CSS 转义", '<div style="background:u\\72l(https://t.example/x)">x</div>', ["<div>x</div>"]],
    ["style 属性 behavior / -moz-binding", '<div style="behavior:url(x.htc)">a</div><p style="-moz-binding:url(x.xml#b)">b</p>', ["<div>a</div>", "<p>b</p>"]],
    ["style 元素 @import", "<style>@import url(https://evil.example/x.css); p{color:red}</style><p>x</p>", ["<style></style>"]],
    ["style 元素 expression", "<style>p{width:expression(alert(1))}</style>", ["<style></style>"]],
    ["style 元素试图闭合跳出", "<style>p{color:red}</style><p>x</p>", ["<style>p{color:red}</style>"]],
  ])("%s", async (_name, html, mustContain) => {
    const out = await sanitize(html);
    expect(out).not.toMatch(DANGEROUS);
    for (const fragment of mustContain) expect(out).toContain(fragment);
  });
});

describe("解析边角", () => {
  it("拆开的 script 标签：lol-html 与浏览器都把 `<scr<script>` 当成名为 scr<script 的未知元素，没有 script 元素", async () => {
    const out = await sanitize("<scr<script>ipt>alert(1)</script><p>x</p>");
    expect(out).toBe("<scr<script>ipt>alert(1)</script><p>x</p>");
    // 真正的 script 元素一定被删：同样的输入里补一个完整的 script
    expect(await sanitize("<scr<script>ipt><script>alert(1)</script>")).toBe("<scr<script>ipt>");
  });

  it.each([
    '<a href="https://ok.example/" href="javascript:alert(1)">x</a>',
    '<a href="https://ok.example/" href="https://other.example/">x</a>',
    '<a href="javascript:alert(1)" HREF="https://ok.example/">x</a>',
  ])("同名属性出现多次：整个删除，原始值不留在输出里 %s", async (html) => {
    expect(await sanitize(html)).toBe("<a>x</a>");
  });

  it("重复的 style 属性同样整个删除", async () => {
    expect(await sanitize('<p style="color:red" style="background:url(https://t.example/x)">x</p>')).toBe("<p>x</p>");
  });

  it("未闭合的危险元素：删除到文档结尾（宁可多删）", async () => {
    expect(await sanitize("<p>a</p><iframe><p>b</p>")).toBe("<p>a</p>");
  });
});

describe("链接处理", () => {
  it("保留的链接重写为规范化 URL，& 转义，外部链接加 rel 与 target，去掉原 target、ping、attributionsrc", async () => {
    const out = await sanitize('<a href="https://OK.example/p?a=1&b=2" target="_top" ping="https://t.example" attributionsrc="https://t.example/a">x</a>');
    expect(out).toBe('<a href="https://ok.example/p?a=1&amp;b=2" rel="noopener noreferrer" target="_blank">x</a>');
  });

  it("#片段链接不加 target=_blank", async () => {
    expect(await sanitize('<a href="#top" target="_top">x</a>')).toBe('<a href="#top">x</a>');
  });

  it.each<[string, string | null]>([
    ["#section", "#section"],
    ["mailto:a@b.example", "mailto:a@b.example"],
    ["https://ok.example/", "https://ok.example/"],
    ["//evil.example/x", null],
    ["relative/path", null],
    ["cid:abc", null],
    ["ftp://files.example/x", null],
  ])("links=keep 时 href=%j → %j", async (href, expected) => {
    const out = await sanitize(`<a href="${href}">x</a>`);
    if (expected === null) expect(out).not.toContain("href=");
    else expect(out).toContain(`href="${expected}"`);
  });

  it("links=strip：去掉所有 href，保留文字", async () => {
    const out = await sanitize('<a href="https://ok.example/">x</a><a href="#a">y</a>', { ...KEEP, links: "strip" });
    expect(out).toBe("<a>x</a><a>y</a>");
  });

  it("links=allow_domains：只保留允许域名（含子域名），相似域名与 mailto 去掉", async () => {
    const options: HtmlSanitizeOptions = { ...KEEP, links: { allow_domains: ["openai.com"] }, allowDomains: compileDomainList(["openai.com"]) };
    const out = await sanitize(
      '<a href="https://auth.openai.com/x">1</a><a href="https://openai.com.evil.io/">2</a><a href="https://fakeopenai.com/">3</a><a href="mailto:a@openai.com">4</a>',
      options,
    );
    expect(out.match(/href="/gu)?.length).toBe(1);
    expect(out).toContain('href="https://auth.openai.com/x"');
  });
});

describe("远程图片", () => {
  const DATA_PNG = "data:image/png;base64,iVBORw0KGgo=";

  it.each<[string, "block" | "allow", string, string[], string[]]>([
    ["block：移除远程 img src，保留 alt", "block", '<img src="https://t.example/p.gif" alt="logo">', ['alt="logo"'], ["src="]],
    ["block：保留 data: 图片", "block", `<img src="${DATA_PNG}">`, [`src="${DATA_PNG}"`], []],
    ["block：移除 srcset", "block", '<img srcset="https://t.example/a.png 1x, https://t.example/b.png 2x">', ["<img>"], ["srcset"]],
    ["block：移除 background 属性", "block", '<table background="https://t.example/bg.png"><tr><td>x</td></tr></table>', ["<table>"], ["background"]],
    ["block：style 里的远程 url() 换成 none", "block", '<td style="background:url(https://t.example/p.gif) no-repeat;color:red">x</td>', ['style="background:none no-repeat;color:red"'], ["t.example"]],
    ["block：style 元素里的远程 url()", "block", "<style>p{background:url('https://t.example/x.png')}</style>", ["<style>p{background:none}</style>"], ["t.example"]],
    ["block：style 里的 data: 图片保留", "block", `<p style="background:url(${DATA_PNG})">x</p>`, [DATA_PNG], []],
    ["block：未闭合的 url( 整段丢弃", "block", '<p style="background:url(https://t.example/x">x</p>', ["<p>x</p>"], ["t.example"]],
    ["block：image-set 整段丢弃", "block", '<p style="background-image:image-set(&quot;https://t.example/x.png&quot; 1x)">x</p>', ["<p>x</p>"], ["t.example"]],
    ["allow：https 图片保留", "allow", '<img src="https://t.example/p.gif">', ['src="https://t.example/p.gif"'], []],
    ["allow：http 图片仍移除（CSP 只放 https）", "allow", '<img src="http://t.example/p.gif">', ["<img>"], ["src="]],
    ["allow：srcset 全是 https 时保留", "allow", '<img srcset="https://t.example/a.png 1x, https://t.example/b.png 2x">', ['srcset="https://t.example/a.png 1x, https://t.example/b.png 2x"'], []],
    ["allow：srcset 里有一项不是 https 时整条移除", "allow", '<img srcset="https://t.example/a.png 1x, javascript:alert(1) 2x">', ["<img>"], ["srcset"]],
    ["allow：cid: 图片移除", "allow", '<img src="cid:part1">', ["<img>"], ["cid:"]],
  ])("%s", async (_name, remoteImages, html, contains, absent) => {
    const out = await sanitize(html, { ...KEEP, remoteImages });
    for (const fragment of contains) expect(out).toContain(fragment);
    for (const fragment of absent) expect(out).not.toContain(fragment);
    expect(out).not.toMatch(DANGEROUS);
  });
});

describe("CSP 与 srcdoc 文档", () => {
  it.each<["block" | "allow", string]>([
    ["block", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"],
    ["allow", "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'none'"],
  ])("remote_images=%s", (mode, csp) => {
    expect(buildMailCsp(mode)).toBe(csp);
    expect(buildMailCspMetaTag(mode)).toBe(`<meta http-equiv="Content-Security-Policy" content="${csp}">`);
  });

  it("CSP meta 位于我们自己 head 的最前面，邮件内容放进 body", () => {
    const doc = wrapMailHtmlDocument("<p>x</p>", "block");
    expect(doc.startsWith(`<!DOCTYPE html><html><head>${buildMailCspMetaTag("block")}</head><body>`)).toBe(true);
    // 清洗结果之后不追加任何内容
    expect(doc.endsWith("<body><p>x</p>")).toBe(true);
  });
});

describe("URL 判定辅助", () => {
  it.each<[string, string]>([
    ["&#106;&#x61;&colon;", "ja:"],
    ["&amp;&lt;&GT;&Tab;", "&<>\t"],
    ["&#0;&#xD800;&#99999999;", "\uFFFD\uFFFD\uFFFD"],
    ["&unknown;x", "&unknown;x"],
  ])("decodeHtmlEntities(%j)", (input, expected) => {
    expect(decodeHtmlEntities(input)).toBe(expected);
  });

  it.each<[string, string]>([
    ["https://a.example/", "http"],
    ["mailto:x@y.example", "mailto"],
    ["#top", "fragment"],
    ["DATA:image/png;base64,AA==", "data_image"],
    ["data:text/html,x", "blocked"],
    ["javascript:alert(1)", "blocked"],
    ["/relative", "blocked"],
  ])("classifyUrl(%j).kind = %s", (input, kind) => {
    expect(classifyUrl(input).kind).toBe(kind);
  });
});

describe("截断的标签不能在包装后变成活标签（验收必修 2）", () => {
  it.each<[string, string]>([
    ["未完成的 img onerror", "<p>a</p><img src=x onerror=alert(1)//   "],
    ["未完成的 javascript: 链接", "<p>a</p><a href=javascript:alert(1)//"],
    ["未完成的 style 远程图片（block）", "<p>a</p><p style=background:url(https://t.example/x)"],
    ["带引号未闭合（引号里含 >）", '<p>a</p><a title="x>y" href="javascript:alert(1)'],
    ["<a 后跟换行", "<p>a</p><a\n"],
    ["末尾未闭合的注释", "<p>a</p><!-- <img src=x onerror=alert(1)>"],
  ])("%s", async (_name, html) => {
    const out = await sanitize(html);
    expect(out).toBe("<p>a</p>");
    const doc = wrapMailHtmlDocument(out, "block");
    expect(doc.endsWith("<body><p>a</p>")).toBe(true);
    expect(out).not.toMatch(DANGEROUS);
    expect(doc).not.toContain("t.example");
  });

  it.each<[string, string]>([
    ["title 里的注释开头", '<p>a</p><title><!--</title><a title="-->" onclick=alert(1)//'],
    ["xmp", "<p>a</p><xmp><img src=x onerror=alert(1)></xmp>"],
    ["noembed", "<p>a</p><noembed><img src=x onerror=alert(1)></noembed>"],
    ["noframes", "<p>a</p><noframes><img src=x onerror=alert(1)></noframes>"],
    ["plaintext", "<p>a</p><plaintext><img src=x onerror=alert(1)>"],
  ])("RCDATA / 原始文本元素整段删除：%s", async (_name, html) => {
    const out = await sanitize(html);
    expect(out.startsWith("<p>a</p>")).toBe(true);
    expect(out).not.toMatch(/<\s*(title|xmp|noembed|noframes|plaintext)\b/iu);
    expect(out).not.toMatch(DANGEROUS);
    expect(out).not.toContain("onclick");
  });

  it("末尾是完整标签或普通文本时不截", async () => {
    expect(await sanitize('<p title="a<b">x</p> 1 < 2')).toBe('<p title="a<b">x</p> 1 < 2');
  });
});

describe("清洗失败", () => {
  it("lol-html 解析器放弃时抛 HtmlSanitizeError，不返回原始 HTML", async () => {
    const html = "<select><style>p{}</style></select><img src=x onerror=alert(1)>";
    const error = await sanitize(html).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HtmlSanitizeError);
    expect((error as Error).message).toContain("HTML 清洗失败");
  });

  it("CSS 里的 src() 整段丢弃", async () => {
    expect(await sanitize('<p style="background-image:src(&quot;https://t.example/x&quot;)">x</p>')).toBe("<p>x</p>");
  });
});
