// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { AdminMailDetail } from "@maillink/shared";
import { adminMailQuery } from "../../api/queries";
import { click, mount } from "../../test/render";
import type { Mounted } from "../../test/render";
import { ToastProvider } from "../../ui";
import { MailDetail } from "./MailDetail";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

const BODY = "第一行\n第二行 https://x.example.com 不是链接";
const RAW = "From: a@b.c\r\nSubject: hi\r\n\r\n第一行";

function okDetail(overrides: Partial<AdminMailDetail> = {}): AdminMailDetail {
  return {
    id: 7,
    received_at: 1_700_000_000,
    recipient: "alias@icloud.com",
    envelope: { source: "bounce@x.com", address: "me@x.com", to_address: "alias@icloud.com" },
    parse_status: "ok",
    parse_error: null,
    raw_size: 2048,
    parsed: {
      subject: "你的验证码",
      from: { address: "no-reply@x.com", name: "X" },
      sender_candidates: { addresses: ["no-reply@x.com"], domains: ["x.com"] },
      body: BODY,
      body_truncated: false,
      links: ["https://x.example.com/a", "javascript:alert(1)"],
      attachments: [{ index: 0, name: "a.pdf", content_type: "application/pdf", size: 10 }],
      code: "123456",
      code_source: "builtin",
      category: "verification",
      headers: [{ key: "Subject", value: "你的验证码" }],
      has_html: true,
    },
    ...overrides,
  };
}

/** 详情接口的响应预置进缓存（staleTime 内不会发请求），其余视图只靠本地状态切换 */
async function openDetail(plain: AdminMailDetail, withRaw: AdminMailDetail = { ...plain, raw: RAW }): Promise<HTMLElement> {
  const client = new QueryClient();
  client.setQueryData(adminMailQuery(plain.id, false).queryKey, plain);
  client.setQueryData(adminMailQuery(plain.id, true).queryKey, withRaw);
  const tree = createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(MailDetail, { id: plain.id, onBack: () => {} })));
  mounted = await mount(tree);
  return mounted.container;
}

function radio(container: HTMLElement, label: string): HTMLInputElement {
  const found = Array.from(container.querySelectorAll("label")).find((l) => l.textContent === label)?.querySelector("input");
  if (!found) throw new Error(`找不到视图：${label}`);
  return found;
}

describe("MailDetail：视图切换", () => {
  it("默认“正文”：没有 HTML 正文时显示纯文本并说明原因", async () => {
    const container = await openDetail(okDetail());
    expect(radio(container, "正文").checked).toBe(true);
    expect(container.querySelector(".mail-text")?.textContent).toBe(BODY);
    expect(container.textContent).toContain("HTML 正文将在后端开放后显示");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("四个视图：正文 / 纯文本 / 原文 / 邮件头", async () => {
    const container = await openDetail(okDetail());
    const labels = Array.from(container.querySelectorAll(".segmented label")).map((l) => l.textContent);
    expect(labels).toEqual(["正文", "纯文本", "原文", "邮件头"]);

    await click(radio(container, "纯文本"));
    expect(container.querySelector(".mail-view .mail-text")?.textContent).toBe(BODY);
    expect(container.querySelector(".mail-view")?.textContent).not.toContain("HTML 正文将在后端开放后显示");

    await click(radio(container, "邮件头"));
    expect(container.querySelector(".mail-headers")?.textContent).toContain("Subject");

    await click(radio(container, "原文"));
    expect(container.querySelector(".mail-raw")?.textContent).toBe(RAW);

    await click(radio(container, "正文"));
    expect(container.querySelector(".mail-view .mail-text")?.textContent).toBe(BODY);
  });

  it("链接列表：等宽纯文本 + 每条一个复制按钮，整个详情里不产生任何 <a>（附件下载除外）", async () => {
    const container = await openDetail(okDetail());
    const section = container.querySelector(".mail-links");
    expect(section?.querySelectorAll("a").length).toBe(0);
    expect(container.querySelectorAll(".mail-view a, .mail-links a, .mail-detail-body > .mail-heading a").length).toBe(0);
    const items = Array.from(section?.querySelectorAll("li") ?? []);
    expect(items.map((li) => li.querySelector(".mail-link-text")?.textContent)).toEqual(["https://x.example.com/a", "javascript:alert(1)"]);
    expect(items.every((li) => li.querySelectorAll("button").length === 1)).toBe(true);
    expect(items[0]?.textContent).toContain("x.example.com");
    expect(items[1]?.querySelector(".dim")).toBeNull();
  });

  it("附件下载走 /api/admin/mails/:id/attachments/:index", async () => {
    const container = await openDetail(okDetail());
    expect(container.querySelector(".mail-attachments a")?.getAttribute("href")).toBe("/api/admin/mails/7/attachments/0");
  });

  it("解析失败：显示错误，默认直接看原文；其他视图指向原文", async () => {
    const failed = okDetail({ parse_status: "failed", parse_error: "邮件没有头部", parsed: null });
    const container = await openDetail(failed, { ...failed, raw: RAW });
    expect(container.textContent).toContain("解析失败");
    expect(radio(container, "原文").checked).toBe(true);
    expect(container.querySelector(".mail-raw")?.textContent).toBe(RAW);

    await click(radio(container, "正文"));
    expect(container.querySelector(".mail-view")?.textContent).toContain("邮件没有头部");
    expect(container.querySelector(".mail-raw")).toBeNull();
  });

  it("原文取不到（如原文丢失）：明确说明原因，不显示空白", async () => {
    const failed = okDetail({ parse_status: "failed", parse_error: "原文丢失：raw 与 raw_blob 都为空", parsed: null });
    const container = await openDetail(failed, failed);
    expect(container.querySelector(".mail-view")?.textContent).toContain("原文不可用");
    expect(container.querySelector(".mail-view")?.textContent).toContain("原文丢失");
  });
});
