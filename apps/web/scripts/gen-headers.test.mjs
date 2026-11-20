// gen-headers.mjs 的单元测试（Node 内置 node:test），由 apps/web 的 `pnpm test` 调用。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { assertCspCompatible, buildHeadersFile, contentSecurityPolicy, inlineScriptHashes } from "./gen-headers.mjs";

const sha = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
const page = (head, body = "") => `<!doctype html><html><head>${head}</head><body><div id="root"></div>${body}</body></html>`;

describe("inlineScriptHashes", () => {
  it("只给没有 src 的内联脚本算哈希，正文逐字节（含换行与空白），重复的去重", () => {
    const inline = '\n  document.documentElement.setAttribute("data-theme", "dark");\n';
    const html = page(`<script>${inline}</script><script type="module" crossorigin src="/assets/a.js"></script><script>${inline}</script>`);
    assert.deepEqual(inlineScriptHashes(html), [sha(inline)]);
  });

  it("没有内联脚本时为空，CSP 里只有 self 与 Turnstile", () => {
    const hashes = inlineScriptHashes(page('<script type="module" src="/assets/a.js"></script>'));
    assert.deepEqual(hashes, []);
    assert.match(contentSecurityPolicy(hashes), /script-src 'self' https:\/\/challenges\.cloudflare\.com;/u);
  });
});

describe("构建失败的情况", () => {
  it("on*= 事件属性", () => {
    assert.throws(() => inlineScriptHashes(page("", '<img src="x.png" onerror="boot()">')), /事件属性/u);
    assert.throws(() => assertCspCompatible(page("", "<body onload=start()>")), /事件属性/u);
  });

  it("javascript: 链接", () => {
    assert.throws(() => inlineScriptHashes(page("", '<a href="JavaScript:alert(1)">x</a>')), /javascript:/u);
  });

  it("<script> 属性里含 >", () => {
    assert.throws(() => inlineScriptHashes(page('<script data-x="a>b">run()</script>')), /属性里含有/u);
  });

  it("脚本正文里出现 onclick= 或 javascript: 字样不算（它们由哈希覆盖，不是标签属性）", () => {
    const inline = 'const s = "<a onclick=x>"; const u = "javascript:void 0";';
    assert.deepEqual(inlineScriptHashes(page(`<script>${inline}</script>`)), [sha(inline)]);
  });
});

describe("buildHeadersFile", () => {
  it("全站安全头 + /s/* 的 no-store 与 noindex，内联哈希进 script-src", () => {
    const inline = "window.x = 1;";
    const text = buildHeadersFile(page(`<script>${inline}</script>`));
    const lines = text.trimEnd().split("\n");
    assert.equal(lines[0], "/*");
    assert.ok(lines[1]?.startsWith(`  Content-Security-Policy: default-src 'self'; script-src 'self' ${sha(inline)} https://challenges.cloudflare.com;`));
    for (const header of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "img-src 'self' data: https:"]) {
      assert.ok(lines[1]?.includes(header), header);
    }
    assert.ok(lines.includes("  Referrer-Policy: no-referrer"));
    assert.ok(lines.includes("  X-Content-Type-Options: nosniff"));
    assert.ok(lines.some((line) => line.startsWith("  Permissions-Policy: ") && line.includes("camera=()")));
    const pickup = lines.indexOf("/s/*");
    assert.ok(pickup > 0);
    assert.deepEqual(lines.slice(pickup + 1), ["  Cache-Control: no-store", "  X-Robots-Tag: noindex, nofollow"]);
  });
});
