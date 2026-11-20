import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminMailDetail } from "@maillink/shared";
import { getVisibleMailDetail } from "../src/access";
import type * as HtmlSanitizeModule from "../src/render/html-sanitize";
import { nowSec } from "../src/clock";
import { baseConfig, putMail, scopeOf } from "./access-helpers";
import { adminSession, api, resetApp } from "./helpers";

// 清洗失败（HtmlSanitizeError）的降级：只给纯文本、记日志，绝不回退原始 HTML。
// 能让取文字成功而清洗器失败的真实输入很难稳定构造，这里替换清洗器：遇到标记就抛 HtmlSanitizeError。

const FAIL_MARKER = "TRIGGER-SANITIZE-FAILURE";

vi.mock("../src/render/html-sanitize", async (importOriginal) => {
  const original = await importOriginal<typeof HtmlSanitizeModule>();
  return {
    ...original,
    sanitizeEmailHtml: async (html: string, options: Parameters<typeof original.sanitizeEmailHtml>[1]) => {
      if (html.includes(FAIL_MARKER)) throw new original.HtmlSanitizeError(new Error("simulated parser error"));
      return await original.sanitizeEmailHtml(html, options);
    },
  };
});

const A = "alice@example.com";
const html = `<p>${FAIL_MARKER}</p><img src=x onerror=alert(1)>`;

beforeEach(async () => {
  await resetApp();
});

describe("HtmlSanitizeError 降级为纯文本", () => {
  it("访客视角详情：只有 text，没有 html，console.error 记录", async () => {
    const id = await putMail({ address: A, html, text: "plain fallback" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const shown = await getVisibleMailDetail(env, scopeOf([A], baseConfig({ present: { view: "full" } })), id, { now: nowSec() });
    expect(shown.html).toBeUndefined();
    expect(shown.text).toContain("plain fallback");
    expect(JSON.stringify(shown)).not.toContain("onerror");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("管理员详情：parsed 里不带 html，其余照常", async () => {
    const { cookie } = await adminSession();
    const id = await putMail({ address: A, html, text: "plain fallback" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await api(`/api/admin/mails/${id}`, { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminMailDetail;
    expect(body.parsed?.has_html).toBe(true);
    expect(body.parsed?.html).toBeUndefined();
    expect(body.parsed?.body).toContain("plain fallback");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
