// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { click, mount } from "../../test/render";
import type { Mounted } from "../../test/render";
import { AttachmentList } from "./AttachmentList";
import { MailBody } from "./MailBody";
import { MailHeaderList } from "./MailHeaderList";
import { MAIL_FRAME_SANDBOX, MailHtmlFrame } from "./MailHtmlFrame";
import { MailText } from "./MailText";
import { formatBytes, isHttpUrl } from "./labels";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

// 含引号、尖括号、&、换行、脚本与外链：srcDoc 必须原样（逐字节）传入
const HTML = '<!doctype html><html><body style="margin:0"><p class="a">&amp; "x" \'y\'</p>\n<script>alert(1)</script><img src="https://t.example.com/p.gif"></body></html>';

describe("MailHtmlFrame（PLAN「邮件 HTML 展示的硬性要求」第 1 条）", () => {
  it("sandbox 属性值精确相等，且 srcdoc 等于输入", async () => {
    mounted = await mount(createElement(MailHtmlFrame, { html: HTML, title: "t" }));
    const frame = mounted.container.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("allow-popups allow-popups-to-escape-sandbox");
    expect(frame?.getAttribute("srcdoc")).toBe(HTML);
    expect(MAIL_FRAME_SANDBOX).toBe("allow-popups allow-popups-to-escape-sandbox");
  });

  it("sandbox 里没有任何多余的令牌", async () => {
    mounted = await mount(createElement(MailHtmlFrame, { html: "<p>x</p>", title: "t" }));
    const tokens = (mounted.container.querySelector("iframe")?.getAttribute("sandbox") ?? "").split(" ");
    expect(tokens).toEqual(["allow-popups", "allow-popups-to-escape-sandbox"]);
    for (const forbidden of ["allow-scripts", "allow-same-origin", "allow-forms", "allow-downloads", "allow-top-navigation"]) {
      expect(tokens.some((token) => token.startsWith(forbidden))).toBe(false);
    }
  });

  it("没有 src，不加载任何外部地址；带 no-referrer", async () => {
    mounted = await mount(createElement(MailHtmlFrame, { html: HTML, title: "t" }));
    const frame = mounted.container.querySelector("iframe");
    expect(frame?.hasAttribute("src")).toBe(false);
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("“展开全高 / 收起”切换高度档位，并清掉拖拽留下的 inline 高度", async () => {
    mounted = await mount(createElement(MailHtmlFrame, { html: "<p>x</p>", title: "t" }));
    const box = mounted.container.querySelector<HTMLElement>(".mail-frame-box");
    const button = mounted.container.querySelector("button");
    expect(box?.dataset["expanded"]).toBe("false");
    box?.style.setProperty("height", "321px");
    if (button) await click(button);
    expect(box?.dataset["expanded"]).toBe("true");
    expect(box?.style.height).toBe("");
    expect(button?.textContent).toBe("收起");
  });
});

describe("MailBody", () => {
  it("有 html 时用隔离框，没有时显示纯文本并说明 HTML 没有显示（不回退原始 HTML）", () => {
    const withHtml = renderToStaticMarkup(createElement(MailBody, { html: "<p>h</p>", text: "t", hasHtml: true, title: "x" }));
    expect(withHtml).toContain("<iframe");
    const withoutHtml = renderToStaticMarkup(createElement(MailBody, { html: null, text: "纯文本", hasHtml: true, title: "x" }));
    expect(withoutHtml).not.toContain("<iframe");
    expect(withoutHtml).toContain("这封邮件的 HTML 正文没有显示");
    expect(withoutHtml).toContain("纯文本");
  });

  it("邮件本来就没有 HTML 时不显示“HTML 没有显示”的说明", () => {
    const html = renderToStaticMarkup(createElement(MailBody, { html: null, text: "只有文本", hasHtml: false, title: "x" }));
    expect(html).not.toContain("HTML 正文没有显示");
  });
});

describe("MailText（第 4 条：纯文本、不链接化）", () => {
  const TEXT = "访问 https://evil.example.com/x?a=1&b=2 或 www.example.org、evil.com、192.168.0.1\n第二行\n\n<a href=\"https://x.test\">点我</a><script>alert(1)</script>";

  it("不产生任何 <a>，标签被转义成文字", () => {
    const html = renderToStaticMarkup(createElement(MailText, { text: TEXT }));
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;a href=");
    expect(html).toContain("https://evil.example.com/x?a=1&amp;b=2");
  });

  it("真实 DOM 里没有 a / script / img 元素，文本逐字保留（含换行）", async () => {
    mounted = await mount(createElement(MailText, { text: TEXT }));
    expect(mounted.container.querySelectorAll("a, script, img").length).toBe(0);
    expect(mounted.container.querySelector(".mail-text")?.textContent).toBe(TEXT);
  });

  it("空正文显示明确说明", () => {
    expect(renderToStaticMarkup(createElement(MailText, { text: "" }))).toContain("没有正文");
  });
});

describe("MailHeaderList / AttachmentList", () => {
  it("邮件头按出现顺序逐行显示，同名头不合并，值不被当成链接", () => {
    const html = renderToStaticMarkup(
      createElement(MailHeaderList, {
        headers: [
          { key: "Received", value: "from a.example (1.2.3.4)" },
          { key: "Received", value: "from <b.example>; https://x.test" },
        ],
      }),
    );
    expect(html.match(/Received/g)?.length).toBe(2);
    expect(html).not.toContain("<a");
  });

  it("附件：名称是纯文本，下载地址由调用方给出", () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentList, {
        attachments: [{ index: 3, name: "<b>x</b>.pdf", content_type: "application/pdf", size: 1536 }],
        hrefFor: (attachment) => `/api/admin/mails/9/attachments/${attachment.index}`,
      }),
    );
    expect(html).toContain('href="/api/admin/mails/9/attachments/3"');
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;.pdf");
    expect(html).toContain("1.5 KB");
    expect(html).toContain("download");
  });
});

describe("labels", () => {
  it("formatBytes", () => {
    expect([formatBytes(0), formatBytes(1023), formatBytes(1536), formatBytes(10 * 1024 * 1024)]).toEqual(["0 B", "1023 B", "1.5 KB", "10 MB"]);
  });

  it("isHttpUrl 只认 http(s)://", () => {
    expect(isHttpUrl("https://a.example/x")).toBe(true);
    expect(isHttpUrl("http://a.example")).toBe(true);
    for (const value of ["javascript:alert(1)", "data:text/html,x", "//a.example", " https://a.example", "ftp://a.example", "a.example"]) {
      expect(isHttpUrl(value)).toBe(false);
    }
  });
});

/** 去掉注释再扫：注释里解释“为什么不能加 allow-same-origin”不算违规 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("源码守卫（硬性要求第 4 条）", () => {
  it("邮件相关组件不使用 dangerouslySetInnerHTML，也不写 allow-same-origin / allow-scripts", () => {
    const dirs = [join(import.meta.dirname), join(import.meta.dirname, "../mails")];
    const sources = dirs.flatMap((dir) =>
      readdirSync(dir)
        .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
        .map((name) => ({ name, text: stripComments(readFileSync(join(dir, name), "utf8")) })),
    );
    expect(sources.length).toBeGreaterThan(10);
    for (const { name, text } of sources) {
      expect(text, name).not.toContain("dangerouslySetInnerHTML");
      expect(text, name).not.toMatch(/allow-same-origin|allow-scripts|allow-forms|allow-downloads|allow-top-navigation/);
      expect(text, name).not.toContain("innerHTML");
    }
  });
});
