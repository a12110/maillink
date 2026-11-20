// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MailDbCompat } from "@maillink/shared";
import { queryKeys } from "../../api/queries";
import { createAppRouter } from "../../app/router";
import { byText, settle } from "../../test/dom";
import { errorReply, installFakeFetch } from "../../test/fake-fetch";
import type { FakeFetch, FakeHandler } from "../../test/fake-fetch";
import { makePublicConfig } from "../../test/fixtures";
import { testQueryClient } from "../../test/providers";
import { click, mount, typeInto } from "../../test/render";
import type { Mounted } from "../../test/render";
import { ToastProvider } from "../../ui";
import { hasIcloudAlias, NO_ICLOUD_BODY, NO_ICLOUD_TITLE } from "./notice-text";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const OK: MailDbCompat = { status: "ok", db_version: "v0.0.11", missing_required: [] };
const NO_ICLOUD: MailDbCompat = { status: "no_icloud", db_version: "v0.0.11", missing_required: [] };
const UNHEALTHY: MailDbCompat = { status: "unhealthy", db_version: null, missing_required: ["created_at", "raw"] };
const PROBE_FAILED: MailDbCompat = { status: "probe_failed", db_version: null, missing_required: [], error_code: "binding_missing" };

const SESSION = { user: { id: 1, username: "root", display_name: null, email: null, role: "admin" }, auth_methods: ["password"], expires_at: 2_000_000_000 };
const EMPTY_LIST = { items: [], next_cursor: null, total: 0, active_count: 0, disabled_count: 0 };

async function openPage(url: string, handlers: Record<string, FakeHandler>, setup: unknown): Promise<{ box: HTMLElement; server: FakeFetch }> {
  const server = installFakeFetch({
    "GET /api/public/config": { json: makePublicConfig() },
    "GET /api/auth/session": { json: SESSION },
    "GET /api/admin/mailboxes": { json: EMPTY_LIST },
    "GET /api/admin/mailboxes/tags": { json: { items: [], truncated: false } },
    ...handlers,
  });
  const client = testQueryClient();
  client.setQueryData(queryKeys.session, url === "/setup" ? null : SESSION);
  client.setQueryData(queryKeys.setupStatus, setup);
  const router = createAppRouter({ client, history: createMemoryHistory({ initialEntries: [url] }) });
  await router.load();
  mounted = await mount(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(RouterProvider, { router }))));
  await settle();
  return { box: mounted.container, server };
}

const openSetup = (mailDb: MailDbCompat) => openPage("/setup", {}, { needs_setup: true, mail_db: mailDb });
const openMailboxes = (handler: FakeHandler) => openPage("/admin/mailboxes", { "GET /api/admin/system/mail-db": handler }, { needs_setup: false });
const notices = (root: ParentNode) => Array.from(root.querySelectorAll(".callout"));

describe("初始化页的邮件库提示", () => {
  it("ok：不显示任何提示", async () => {
    const { box } = await openSetup(OK);
    expect(box.querySelector("h1")?.textContent).toBe("初始化系统");
    expect(notices(box)).toEqual([]);
  });

  it("no_icloud：醒目的警告，写明不支持 iCloud 隐私邮箱、影响范围与升级办法，且不阻断表单", async () => {
    const { box } = await openSetup(NO_ICLOUD);
    const [callout] = notices(box);
    expect(callout?.getAttribute("data-tone")).toBe("warning");
    const text = callout?.textContent ?? "";
    for (const keyword of ["不支持 iCloud 隐私邮箱", "Hide My Email", "to_address", "收不到邮件", "其他收件地址不受影响", "db/2026-08-02-to-address.sql", "v1.15.0", "刷新本页"]) {
      expect(text, keyword).toContain(keyword);
    }
    expect(box.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled).toBe(false);
    expect(box.querySelectorAll("input").length).toBe(3);
  });

  it("unhealthy：danger 错误，列出缺失的列，说明初始化后无法读取邮件，仍可提交", async () => {
    const { box } = await openSetup(UNHEALTHY);
    const [callout] = notices(box);
    expect(callout?.getAttribute("data-tone")).toBe("danger");
    expect(callout?.getAttribute("role")).toBe("alert");
    expect(callout?.textContent).toContain("邮件库（MAIL_DB）不可用");
    expect(callout?.textContent).toContain("初始化后将无法读取邮件");
    expect(callout?.textContent).toContain("created_at、raw");
    expect(box.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled).toBe(false);
  });

  it("probe_failed：danger 错误，带错误码", async () => {
    const { box } = await openSetup(PROBE_FAILED);
    const [callout] = notices(box);
    expect(callout?.getAttribute("data-tone")).toBe("danger");
    expect(callout?.textContent).toContain("无法探测邮件库（MAIL_DB）");
    expect(callout?.textContent).toContain("binding_missing");
  });

  it("沿用路由守卫已取到的状态，不再额外请求 /api/setup/status", async () => {
    const { server } = await openSetup(NO_ICLOUD);
    expect(server.callsTo("GET /api/setup/status")).toEqual([]);
  });
});

describe("收件地址页的常驻提示", () => {
  it("ok：没有提示", async () => {
    const { box, server } = await openMailboxes({ json: OK });
    expect(server.callsTo("GET /api/admin/system/mail-db")).toHaveLength(1);
    expect(notices(box)).toEqual([]);
  });

  it("no_icloud：页面顶部显示与初始化页同一条警告（无“刷新本页”后缀）", async () => {
    const { box } = await openMailboxes({ json: NO_ICLOUD });
    const [callout] = notices(box);
    expect(callout?.getAttribute("data-tone")).toBe("warning");
    expect(callout?.textContent).toContain(NO_ICLOUD_TITLE);
    expect(callout?.textContent).toContain(NO_ICLOUD_BODY);
    expect(callout?.textContent).not.toContain("刷新本页");
  });

  it("unhealthy：danger，说明当前无法读取邮件", async () => {
    const { box } = await openMailboxes({ json: UNHEALTHY });
    const [callout] = notices(box);
    expect(callout?.getAttribute("data-tone")).toBe("danger");
    expect(callout?.textContent).toContain("当前无法读取邮件");
  });

  it("查询失败：就地显示错误与错误码，不当作兼容，可重试", async () => {
    const { box, server } = await openMailboxes(errorReply(500, "internal_error", "服务器内部错误"));
    const [callout] = notices(box);
    expect(callout?.getAttribute("data-tone")).toBe("danger");
    expect(callout?.textContent).toContain("无法确认邮件库兼容性");
    expect(callout?.textContent).toContain("internal_error");
    server.set("GET /api/admin/system/mail-db", { json: NO_ICLOUD });
    await click(byText(box, "button", "重试"));
    await settle();
    expect(notices(box)[0]?.textContent).toContain(NO_ICLOUD_TITLE);
  });

  it("导入对话框：同一条提示；粘贴含 iCloud 地址的内容后补一句强调", async () => {
    const { box } = await openMailboxes({ json: NO_ICLOUD });
    await click(byText(box, "button", "导入"));
    await settle();
    const dialog = document.body.querySelector<HTMLElement>("[role=dialog]");
    if (!dialog) throw new Error("没有打开导入对话框");
    expect(notices(dialog)).toHaveLength(1);
    expect(notices(dialog)[0]?.textContent).toContain(NO_ICLOUD_TITLE);
    expect(notices(dialog)[0]?.textContent).not.toContain("你粘贴的内容里含 iCloud 隐私邮箱地址");
    await typeInto(dialog.querySelector("textarea") as HTMLTextAreaElement, "abc@icloud.com");
    expect(notices(dialog)[0]?.textContent).toContain("你粘贴的内容里含 iCloud 隐私邮箱地址");
  });

  it("导入对话框：兼容时没有提示", async () => {
    const { box } = await openMailboxes({ json: OK });
    await click(byText(box, "button", "导入"));
    await settle();
    const dialog = document.body.querySelector<HTMLElement>("[role=dialog]");
    if (!dialog) throw new Error("没有打开导入对话框");
    expect(notices(dialog)).toEqual([]);
  });

  it("导入对话框：查询失败显示错误", async () => {
    const { box } = await openMailboxes(errorReply(503, "unavailable", "不可用"));
    await click(byText(box, "button", "导入"));
    await settle();
    const dialog = document.body.querySelector<HTMLElement>("[role=dialog]");
    if (!dialog) throw new Error("没有打开导入对话框");
    expect(notices(dialog)).toHaveLength(1);
    expect(notices(dialog)[0]?.textContent).toContain("无法确认邮件库兼容性");
  });
});

describe("hasIcloudAlias", () => {
  it("识别 @icloud.com 与 @privaterelay.appleid.com，不区分大小写", () => {
    expect(hasIcloudAlias("a@iCloud.com")).toBe(true);
    expect(hasIcloudAlias("x@privaterelay.appleid.com,OpenAI")).toBe(true);
    expect(hasIcloudAlias("a@gmail.com\nb@example.com")).toBe(false);
    expect(hasIcloudAlias("")).toBe(false);
  });
});
