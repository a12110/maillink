// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { createElement } from "react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MyMailbox, MyMailListItem, PresentedMail, ViewMode } from "@maillink/shared";
import { queryKeys } from "../../api/queries";
import { createAppRouter } from "../../app/router";
import { byText, settle } from "../../test/dom";
import { errorReply, installFakeFetch } from "../../test/fake-fetch";
import type { FakeHandler } from "../../test/fake-fetch";
import { testQueryClient } from "../../test/providers";
import { mount } from "../../test/render";
import type { Mounted } from "../../test/render";
import { ToastProvider } from "../../ui";
import { MAIL_FRAME_SANDBOX } from "../mail";

// 退避延时缩短，partial 重取测试不用等 1 秒
vi.mock("../../constants", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), PARTIAL_RETRY_DELAYS_MS: [5, 5] }));

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

function box(id: number, overrides: Partial<MyMailbox> = {}): MyMailbox {
  return { grant_id: id * 10, mailbox_id: id, address: `a${id}@x.com`, label: null, recipient: "full", view: "full", expires_at: null, available: true, ...overrides };
}
const NOW = Math.floor(Date.now() / 1000);
const ROW: PresentedMail = { id: 7, received_at: NOW - 3600, subject: "你的订单", sender: { name: "Shop", address: "shop@x.com" }, snippet: "感谢购买" };
const CODE: PresentedMail = { id: 8, received_at: NOW - 30, sender: { name: "OpenAI" }, code: "482910" };
const OLD_CODE: PresentedMail = { id: 6, received_at: NOW - 4000, sender: { name: "OpenAI" }, code: "905362" };
/** 列表项带所属授权的 mailbox_id 与 view（后端 B4）；详情响应是纯 PresentedMail，不带这两个字段 */
const of = (mailboxId: number, view: ViewMode, mails: PresentedMail[]): MyMailListItem[] => mails.map((mail) => ({ ...mail, mailbox_id: mailboxId, view }));
const list = (items: MyMailListItem[], extra: Record<string, unknown> = {}) => ({
  json: { items, next_cursor: null, partial: false, next_after_id: null, ...extra },
});
const session = { json: { user: { id: 2, username: "bob", display_name: null, email: null, role: "user" }, auth_methods: ["password"], expires_at: 2_000_000_000 } };

async function openInbox(url: string, handlers: Record<string, FakeHandler>) {
  const server = installFakeFetch({ "GET /api/auth/session": session, ...handlers });
  const client = testQueryClient();
  client.setQueryData(queryKeys.session, session.json);
  client.setQueryData(queryKeys.setupStatus, { needs_setup: false });
  const router = createAppRouter({ client, history: createMemoryHistory({ initialEntries: [url] }) });
  await router.load();
  mounted = await mount(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(RouterProvider, { router }))));
  await settle();
  return { box: mounted.container, server, router };
}

async function switchTo(container: HTMLElement, value: string): Promise<void> {
  const select = container.querySelector<HTMLSelectElement>("#inbox-mailbox");
  if (!select) throw new Error("没有邮箱下拉");
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

describe("我的邮件：邮箱切换与 mailbox_id", () => {
  const mailboxes = { json: { items: [box(1), box(2, { view: "code_only" })], next_cursor: null } };

  it("默认“全部”：不带 mailbox_id；切到具体邮箱后带 mailbox_id=<收件地址 id>", async () => {
    const { box: el, server } = await openInbox("/inbox", { "GET /api/me/mailboxes": mailboxes, "GET /api/me/mails": list(of(1, "full", [ROW])) });
    expect(server.callsTo("GET /api/me/mails")[0]?.url).toBe("/api/me/mails");
    const options = Array.from(el.querySelectorAll("#inbox-mailbox option")).map((o) => o.textContent);
    expect(options).toEqual(["全部邮箱（2）", "a1@x.com", "a2@x.com"]);

    await switchTo(el, "2");
    expect(server.callsTo("GET /api/me/mails").at(-1)?.url).toBe("/api/me/mails?mailbox_id=2");
  });

  it("URL 带 mailbox 时直接请求该邮箱", async () => {
    const { server } = await openInbox("/inbox?mailbox=1", { "GET /api/me/mailboxes": mailboxes, "GET /api/me/mails": list(of(1, "full", [ROW])) });
    expect(server.callsTo("GET /api/me/mails")[0]?.url).toBe("/api/me/mails?mailbox_id=1");
  });

  it("不可用的邮箱灰显并提示联系管理员；地址被隐藏的写“地址已隐藏”", async () => {
    const items = [box(1), box(3, { address: null, recipient: "hidden", view: "text" }), box(4, { address: null, label: null, recipient: null, view: null, available: false })];
    const { box: el } = await openInbox("/inbox", { "GET /api/me/mailboxes": { json: { items, next_cursor: null } }, "GET /api/me/mails": list(of(1, "full", [ROW])) });
    const options = Array.from(el.querySelectorAll<HTMLOptionElement>("#inbox-mailbox option"));
    expect(options.map((o) => o.textContent)).toEqual(["全部邮箱（2）", "a1@x.com", "地址已隐藏（1）", "邮箱 2（暂不可用，请联系管理员）"]);
    expect(options[3]?.disabled).toBe(true);
    expect(el.textContent).toContain("有 1 个邮箱暂时不可用");
  });

  it("通过 URL 进入不可用的邮箱：不发列表请求，说明原因", async () => {
    const items = [box(4, { address: null, label: null, recipient: null, view: null, available: false })];
    const { box: el, server } = await openInbox("/inbox?mailbox=4", { "GET /api/me/mailboxes": { json: { items, next_cursor: null } } });
    expect(server.callsTo("GET /api/me/mails")).toHaveLength(0);
    expect(el.textContent).toContain("这个邮箱暂时不可用，请联系管理员");
  });

  it("没有被分配邮箱：空状态", async () => {
    const { box: el } = await openInbox("/inbox", { "GET /api/me/mailboxes": { json: { items: [], next_cursor: null } } });
    expect(el.textContent).toContain("还没有被分配邮箱");
    expect(el.textContent).toContain("请联系管理员");
  });
});

describe("我的邮件：code_only 与 meta_only 不放详情入口", () => {
  it("code_only：列表显示验证码卡片（等宽大字 + 复制 + 来源与多久之前），没有详情列与可点的行", async () => {
    const items = [box(2, { view: "code_only" })];
    const { box: el } = await openInbox("/inbox?mailbox=2", {
      "GET /api/me/mailboxes": { json: { items, next_cursor: null } },
      "GET /api/me/mails": list(of(2, "code_only", [CODE, OLD_CODE])),
    });
    const cards = Array.from(el.querySelectorAll(".code-card"));
    expect(cards).toHaveLength(2);
    expect(cards[0]?.querySelector(".code-card-code")?.textContent).toBe("482910");
    expect(cards[0]?.textContent).toContain("来自 OpenAI");
    expect(cards[0]?.textContent).toContain("秒前");
    expect(byText(cards[0] as HTMLElement, "button", "复制验证码")).toBeTruthy();
    expect(cards[0]?.getAttribute("data-latest")).toBe("true");
    expect(cards[1]?.getAttribute("data-stale")).toBe("true");
    expect(cards[1]?.textContent).toContain("收到超过 10 分钟，可能已过期");
    expect(el.querySelector(".mail-detail-col")).toBeNull();
    expect(el.querySelector("button.mail-item")).toBeNull();
  });

  it("meta_only：行是只读的，没有详情入口，也不请求详情", async () => {
    const items = [box(3, { view: "meta_only" })];
    const { box: el, server } = await openInbox("/inbox?mailbox=3", {
      "GET /api/me/mailboxes": { json: { items, next_cursor: null } },
      "GET /api/me/mails": list(of(3, "meta_only", [ROW])),
    });
    expect(el.querySelector(".mail-item[data-static='true']")?.textContent).toContain("你的订单");
    expect(el.querySelector("button.mail-item")).toBeNull();
    expect(el.querySelector(".mail-detail-col")).toBeNull();
    expect(server.calls.some((call) => call.path.startsWith("/api/me/mails/"))).toBe(false);
  });

  it("“全部”里按每封自带的 view 决定：code_only 是验证码卡片、meta_only 只读无详情入口、full 可点开详情", async () => {
    const items = [box(1), box(2, { view: "code_only" }), box(3, { view: "meta_only" })];
    const FULL_ROW: PresentedMail = { ...ROW, id: 11, subject: "可看详情" };
    // 收件人显示被隐藏或与邮箱列表对不上，也不影响判断：只看列表项的 view
    const META_ROW: PresentedMail = { ...ROW, id: 7, subject: "只看元信息", recipient: "a1@x.com" };
    const { box: el, server } = await openInbox("/inbox", {
      "GET /api/me/mailboxes": { json: { items, next_cursor: null } },
      "GET /api/me/mails": list([...of(1, "full", [FULL_ROW]), ...of(2, "code_only", [CODE]), ...of(3, "meta_only", [META_ROW])]),
      "GET /api/me/mails/11": { json: { ...FULL_ROW, text: "正文" } },
    });
    expect(el.querySelectorAll(".code-card")).toHaveLength(1);
    expect(el.querySelector(".code-card-code")?.textContent).toBe("482910");
    const meta = el.querySelector(".mail-item[data-static='true']");
    expect(meta?.textContent).toContain("只看元信息");
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>("button.mail-item"));
    expect(buttons.map((button) => button.textContent?.includes("可看详情"))).toEqual([true]);
    await act(async () => buttons[0]?.click());
    await settle();
    expect(server.callsTo("GET /api/me/mails/11")).toHaveLength(1);
    expect(server.callsTo("GET /api/me/mails/11")[0]?.url).toBe("/api/me/mails/11?mailbox_id=1");
    expect(server.calls.some((call) => call.path === "/api/me/mails/7")).toBe(false);
  });

  it("“全部”里打开详情：带上列表项自己的 mailbox_id（来自不同授权的邮件各带各的），附件下载也带", async () => {
    const A: PresentedMail = { ...ROW, id: 21, subject: "来自邮箱一" };
    const B: PresentedMail = { ...ROW, id: 22, subject: "来自邮箱二" };
    const { box: el, server } = await openInbox("/inbox", {
      "GET /api/me/mailboxes": { json: { items: [box(1), box(2)], next_cursor: null } },
      "GET /api/me/mails": list([...of(1, "full", [A]), ...of(2, "full", [B])]),
      "GET /api/me/mails/21": { json: { ...A, text: "一" } },
      "GET /api/me/mails/22": { json: { ...B, text: "二", attachments: [{ index: 0, name: "a.pdf", size: 10, downloadable: true }] } },
    });
    const open = async (subject: string) => {
      const button = Array.from(el.querySelectorAll<HTMLButtonElement>("button.mail-item")).find((candidate) => candidate.textContent?.includes(subject));
      await act(async () => button?.click());
      await settle();
    };
    await open("来自邮箱一");
    expect(server.callsTo("GET /api/me/mails/21").map((call) => call.url)).toEqual(["/api/me/mails/21?mailbox_id=1"]);
    await open("来自邮箱二");
    expect(server.callsTo("GET /api/me/mails/22").map((call) => call.url)).toEqual(["/api/me/mails/22?mailbox_id=2"]);
    expect(el.querySelector<HTMLAnchorElement>(".mail-detail-col a[href*='attachments']")?.getAttribute("href")).toBe("/api/me/mails/22/attachments/0?mailbox_id=2");
  });

  it("“全部”里直接打开 ?id= 的深链接：等列表加载出这封邮件，只请求一次详情，带它的 mailbox_id", async () => {
    const A: PresentedMail = { ...ROW, id: 21, subject: "来自邮箱一" };
    const { server } = await openInbox("/inbox?id=21", {
      "GET /api/me/mailboxes": { json: { items: [box(1), box(2)], next_cursor: null } },
      "GET /api/me/mails": list(of(2, "full", [A])),
      "GET /api/me/mails/21": { json: { ...A, text: "一" } },
    });
    expect(server.callsTo("GET /api/me/mails/21").map((call) => call.url)).toEqual(["/api/me/mails/21?mailbox_id=2"]);
  });

  it("“全部”里深链接的邮件不在第一页：详情先按收件地址请求一次，加载更多后它出现在列表里也不重复请求", async () => {
    const A: PresentedMail = { ...ROW, id: 21, subject: "第一页" };
    const B: PresentedMail = { ...ROW, id: 22, subject: "第二页" };
    const { box: el, server } = await openInbox("/inbox?id=22", {
      "GET /api/me/mailboxes": { json: { items: [box(1), box(2)], next_cursor: null } },
      "GET /api/me/mails": (call) => (call.url.includes("cursor=50") ? list(of(2, "full", [B])) : list(of(1, "full", [A]), { next_cursor: "50" })),
      "GET /api/me/mails/22": { json: { ...B, text: "二" } },
    });
    expect(server.callsTo("GET /api/me/mails/22")).toHaveLength(1);
    await act(async () => byText(el, "button", "加载更多").click());
    await settle();
    expect(el.textContent).toContain("第二页");
    expect(server.callsTo("GET /api/me/mails/22")).toHaveLength(1);
  });

  it("login_link：只显示域名，打开按钮带 rel=noopener noreferrer；javascript: 链接不渲染成链接", async () => {
    const items = [box(2, { view: "code_only" })];
    const { box: el } = await openInbox("/inbox?mailbox=2", {
      "GET /api/me/mailboxes": { json: { items, next_cursor: null } },
      "GET /api/me/mails": list(of(2, "code_only", [
        { id: 9, received_at: NOW - 5, login_link: "https://auth.example.com/magic?t=secret-token" },
        { id: 10, received_at: NOW - 6, login_link: "javascript:alert(1)" },
      ])),
    });
    const anchors = el.querySelectorAll<HTMLAnchorElement>(".code-card a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchors[0]?.getAttribute("target")).toBe("_blank");
    expect(el.textContent).toContain("auth.example.com");
    expect(el.textContent).not.toContain("secret-token");
  });
});

describe("我的邮件：详情复用 features/mail 组件", () => {
  const items = [box(1)];

  it("点一封邮件 → GET /api/me/mails/:id?mailbox_id=；HTML 进沙箱 iframe（sandbox 精确、srcDoc 原样）", async () => {
    const html = "<!DOCTYPE html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'\"></head><body><p>正文</p>";
    const { box: el, server } = await openInbox("/inbox?mailbox=1", {
      "GET /api/me/mailboxes": { json: { items, next_cursor: null } },
      "GET /api/me/mails": list(of(1, "full", [ROW])),
      "GET /api/me/mails/7": { json: { ...ROW, html, text: "正文", attachments: [{ index: 0, name: "a.pdf", size: 10, downloadable: false }] } },
    });
    await act(async () => el.querySelector<HTMLButtonElement>("button.mail-item")?.click());
    await settle();
    expect(server.callsTo("GET /api/me/mails/7")[0]?.url).toBe("/api/me/mails/7?mailbox_id=1");
    const frame = el.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe(MAIL_FRAME_SANDBOX);
    expect(frame?.getAttribute("srcdoc")).toBe(html);
    expect(el.querySelector(".mail-subject")?.textContent).toBe("你的订单");
    expect(el.textContent).toContain("不可下载");
  });

  it("text 视图没有 html：显示纯文本，不链接化，没有 iframe", async () => {
    const { box: el } = await openInbox("/inbox?mailbox=1&id=7", {
      "GET /api/me/mailboxes": { json: { items: [box(1, { view: "text" })], next_cursor: null } },
      "GET /api/me/mails": list(of(1, "text", [ROW])),
      "GET /api/me/mails/7": { json: { ...ROW, text: "访问 https://evil.example.com 与 1.2.3.4" } },
    });
    expect(el.querySelector("iframe")).toBeNull();
    expect(el.querySelector(".mail-text")?.textContent).toBe("访问 https://evil.example.com 与 1.2.3.4");
    expect(el.querySelectorAll(".mail-view a")).toHaveLength(0);
  });
});

describe("我的邮件：partial 与错误", () => {
  const items = [box(1), box(2)];

  it("partial=true：不推进游标，按退避用同样的参数重取同一页，直到完整", async () => {
    let calls = 0;
    const { box: el, server } = await openInbox("/inbox?mailbox=1", {
      "GET /api/me/mailboxes": { json: { items, next_cursor: null } },
      "GET /api/me/mails": () => (++calls === 1 ? list([], { partial: true, next_cursor: "50" }) : list(of(1, "full", [ROW]))),
    });
    await vi.waitFor(() => expect(el.textContent).toContain("你的订单"));
    const urls = server.callsTo("GET /api/me/mails").map((call) => call.url);
    expect(urls).toEqual(["/api/me/mails?mailbox_id=1", "/api/me/mails?mailbox_id=1"]);
  });

  it("422 too_many_scopes：提示改选具体邮箱", async () => {
    const { box: el } = await openInbox("/inbox", {
      "GET /api/me/mailboxes": { json: { items, next_cursor: null } },
      "GET /api/me/mails": errorReply(422, "too_many_scopes", "授权的规则组组合超过 20 种"),
    });
    expect(el.textContent).toContain("邮箱太多，没法合并显示");
    expect(el.textContent).toContain("选择一个具体的邮箱");
  });
});
