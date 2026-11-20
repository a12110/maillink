// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminShareLink, PublicConfig } from "@maillink/shared";
import { queryKeys } from "../../api/queries";
import { makePublicConfig } from "../../test/fixtures";
import { click, mount, typeInto } from "../../test/render";
import type { Mounted } from "../../test/render";
import { ToastProvider } from "../../ui";
import { RevokeDialog } from "./BatchDialogs";
import { ExportPanel } from "./ExportPanel";
import { AccessStep } from "./CreateAccessStep";
import { EMPTY_DRAFT } from "./create-form";
import type { CreateDraft } from "./create-form";
import { LinkTable } from "./LinkTable";
import { StatsSection } from "./PanelSections";

let mounted: Mounted | null = null;
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

function config(turnstile: PublicConfig["turnstile"]): PublicConfig {
  return makePublicConfig({ turnstile });
}

async function render(element: ReturnType<typeof createElement>, publicConfig?: PublicConfig): Promise<HTMLElement> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (publicConfig) client.setQueryData(queryKeys.publicConfig, publicConfig);
  mounted = await mount(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, element)));
  return mounted.container;
}

function Harness({ initial = EMPTY_DRAFT }: { initial?: CreateDraft }) {
  const [draft, setDraft] = useState(initial);
  return createElement(AccessStep, { draft, errors: {}, onChange: (patch: Partial<CreateDraft>) => setDraft((current) => ({ ...current, ...patch })) });
}

const input = (root: HTMLElement, label: string): HTMLInputElement => {
  const field = Array.from(root.querySelectorAll("label")).find((l) => l.textContent?.includes(label))?.closest(".field")?.querySelector("input");
  if (!field) throw new Error(`找不到输入框：${label}`);
  return field;
};

describe("创建表单：取码次数与取码方式", () => {
  it("设了总次数：取码方式自动切到点击取码、选项锁定并说明；清空后恢复可选", async () => {
    const root = await render(createElement(Harness), config({ enabled: false, site_key: "", scopes: [] }));
    const radios = () => Array.from(root.querySelectorAll<HTMLInputElement>('input[name="create-reveal"]'));
    expect(radios().find((radio) => radio.checked)?.value).toBe("auto");
    expect(radios().every((radio) => !radio.disabled)).toBe(true);
    await typeInto(input(root, "总取码次数"), "2");
    expect(radios().find((radio) => radio.checked)?.value).toBe("click");
    expect(radios().every((radio) => radio.disabled)).toBe(true);
    expect(root.textContent).toContain("取码方式已自动切换为“点击取码”");
    await typeInto(input(root, "总取码次数"), "");
    expect(radios().every((radio) => !radio.disabled)).toBe(true);
    expect(root.textContent).not.toContain("已自动切换");
  });

  it("只设每日次数也一样", async () => {
    const root = await render(createElement(Harness), config({ enabled: false, site_key: "", scopes: [] }));
    await typeInto(input(root, "每 24 小时次数"), "5");
    expect(root.querySelector<HTMLInputElement>('input[name="create-reveal"]:checked')?.value).toBe("click");
  });
});

describe("创建表单：人机验证（Turnstile）", () => {
  const checkbox = (root: HTMLElement) => root.querySelector<HTMLInputElement>('.check-row input[type="checkbox"]') as HTMLInputElement;

  it("系统未启用：禁用并说明原因，指向系统设置", async () => {
    const root = await render(createElement(Harness), config({ enabled: false, site_key: "", scopes: [] }));
    expect(checkbox(root).disabled).toBe(true);
    expect(root.textContent).toContain("系统还没有启用 Turnstile");
    expect(root.textContent).toContain("系统设置 → 人机验证");
  });

  it("启用但范围不含取件页：同样禁用", async () => {
    const root = await render(createElement(Harness), config({ enabled: true, site_key: "K", scopes: ["login"] }));
    expect(checkbox(root).disabled).toBe(true);
  });

  it("启用且范围含取件页：可勾选", async () => {
    const root = await render(createElement(Harness), config({ enabled: true, site_key: "K", scopes: ["pickup"] }));
    expect(checkbox(root).disabled).toBe(false);
    await click(checkbox(root));
    expect(checkbox(root).checked).toBe(true);
    expect(root.textContent).not.toContain("系统还没有启用");
  });
});

describe("撤销：二次确认", () => {
  it("写明不可恢复；确认前不发请求，确认后发批量 revoke", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ results: [{ id: 3, ok: true }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const done = vi.fn();
    const closed = vi.fn();
    await render(createElement(RevokeDialog, { ids: [3], onClose: closed, onDone: done }));
    const dialog = document.body.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("撤销是终态，不可恢复");
    expect(dialog.textContent).toContain("链接已失效");
    expect(fetchMock).not.toHaveBeenCalled();
    const confirm = Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent?.startsWith("撤销链接")) as HTMLButtonElement;
    await click(confirm);
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/links/batch");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ ids: [3], action: "revoke" });
    expect(done).toHaveBeenCalledWith({ ok: 1, failed: [] });
  });

  it("取消不发请求；批量撤销写明数量", async () => {
    const closed = vi.fn();
    await render(createElement(RevokeDialog, { ids: [1, 2, 3], onClose: closed, onDone: vi.fn() }));
    const dialog = document.body.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("选中的 3 个链接");
    await click(Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "取消") as HTMLButtonElement);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
  });
});

describe("导出", () => {
  it("行模板不合法时不能导出并给出原因；合法时按模板请求并显示内容", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ format: "template", content: "a@x.com----https://h/s/T\n", count: 1 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const root = await render(createElement(ExportPanel, { ids: [4] }));
    const exportButton = () => Array.from(root.querySelectorAll("button")).find((button) => button.textContent?.includes("导出 1 个链接")) as HTMLButtonElement;
    const template = root.querySelector('input[data-mono="true"]') as HTMLInputElement;
    expect(template.value).toBe("{address}----{link}");
    await typeInto(template, "{address}----{secret}");
    expect(exportButton().disabled).toBe(true);
    expect(root.textContent).toContain("不支持的变量：{secret}");
    await typeInto(template, "{address}----{link}");
    await click(exportButton());
    await vi.waitFor(() => expect(root.querySelector("textarea.export-text")).not.toBeNull());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/links/export");
    expect(JSON.parse(String(init.body))).toEqual({ ids: [4], format: "template", template: "{address}----{link}" });
    expect((root.querySelector("textarea.export-text") as HTMLTextAreaElement).value).toBe("a@x.com----https://h/s/T\n");
  });
});

describe("链接表格", () => {
  const link = (overrides: Partial<AdminShareLink>): AdminShareLink => ({
    id: 1,
    name: "订单 A1001",
    order_ref: "A1001",
    public_title: null,
    public_note: null,
    token_hint: "abc123",
    rule_group: { id: 1, name: "仅验证码" },
    status: "active",
    state: "active",
    valid_from: null,
    expires_at: null,
    expire_after_first_access_sec: null,
    effective_expires_at: null,
    access: { has_password: false, turnstile: false, max_devices: 1, reveal: "auto", ip_allow: [], country_allow: [], poll_interval_sec: 10, api: true },
    anchor_reset_at: null,
    first_access_at: null,
    last_access_at: null,
    mailboxes: [{ id: 1, address: "a@icloud.com", status: "active" }],
    device_count: 1,
    country_count: 1,
    deliveries_24h: 3,
    deliveries_total: 9,
    anomalies: [],
    created_at: 1,
    updated_at: 1,
    ...overrides,
  });

  const noop = () => undefined;
  const props = { loading: false, error: null, filtered: false, page: 1, hasNext: false, selectedId: null, checked: new Set<number>(), onSelect: noop, onToggle: noop, onCopy: noop, onPreview: noop, onToggleAll: noop, onPage: noop, onRetry: noop, onClearFilters: noop, onCreate: noop };

  it("状态、设备数、24 小时取码数、异常标记与多地址数量", async () => {
    const links = [
      link({ id: 1, anomalies: ["device_limit_reached", "multi_country"], access: { has_password: false, turnstile: false, max_devices: 1, reveal: "click", ip_allow: [], country_allow: [], poll_interval_sec: 10, api: true } }),
      link({ id: 2, state: "paused", status: "paused", mailboxes: [{ id: 1, address: "a@x.com", status: "active" }, { id: 2, address: "b@x.com", status: "active" }, { id: 3, address: "c@x.com", status: "active" }], access: { has_password: true, turnstile: false, reveal: "click", ip_allow: [], country_allow: [], poll_interval_sec: 10, api: true } }),
    ];
    const root = await render(createElement(LinkTable, { ...props, links }));
    const rows = Array.from(root.querySelectorAll("tbody tr"));
    expect(rows[0]?.textContent).toContain("生效中");
    expect(rows[0]?.textContent).toContain("设备数已满");
    expect(rows[0]?.textContent).toContain("多国访问");
    expect(rows[0]?.textContent).toContain("1 / 1");
    expect(rows[0]?.textContent).toContain("3");
    expect(rows[1]?.textContent).toContain("已暂停");
    expect(rows[1]?.textContent).toContain("a@x.com 等 3 个");
    expect(rows[1]?.textContent).not.toContain("设备数已满");
  });

  it("24h 取码数：auto 方式不写取码记录，显示“—”并说明，不显示 0；click 方式照常显示数字", async () => {
    const click = { has_password: false, turnstile: false, reveal: "click" as const, max_deliveries_per_day: 5, ip_allow: [], country_allow: [], poll_interval_sec: 10, api: true };
    const links = [link({ id: 1, deliveries_24h: 0 }), link({ id: 2, deliveries_24h: 0, access: click }), link({ id: 3, deliveries_24h: 4, access: click })];
    const root = await render(createElement(LinkTable, { ...props, links }));
    const cells = Array.from(root.querySelectorAll("tbody tr")).map((row) => row.querySelectorAll("td")[7]);
    expect(cells[0]?.textContent).toBe("—");
    expect(cells[0]?.getAttribute("title")).toBe("自动显示模式不计取码次数");
    expect(cells[1]?.textContent).toBe("0");
    expect(cells[1]?.getAttribute("title")).toBe("近 24 小时取码数");
    expect(cells[2]?.textContent).toBe("4");
  });

  it("侧板统计：auto 的 24h 与累计显示“—”并说明，click 显示数字", async () => {
    const click = { has_password: false, turnstile: false, reveal: "click" as const, ip_allow: [], country_allow: [], poll_interval_sec: 10, api: true };
    const values = (root: HTMLElement) => Array.from(root.querySelectorAll("dd")).map((dd) => dd.textContent);
    let root = await render(createElement(StatsSection, { link: link({ deliveries_24h: 0, deliveries_total: 0 }) }));
    expect(values(root)).toEqual(["1 / 1", "1", "—", "—", "—"]);
    expect(root.querySelector("dd .dim")?.getAttribute("title")).toBe("自动显示模式不计取码次数");
    await mounted?.unmount();
    root = await render(createElement(StatsSection, { link: link({ deliveries_24h: 0, deliveries_total: 7, access: click }) }));
    expect(values(root).slice(2, 4)).toEqual(["0", "7"]);
  });

  it("空列表：引导创建；有筛选时给清除筛选", async () => {
    const root = await render(createElement(LinkTable, { ...props, links: [] }));
    expect(root.textContent).toContain("还没有取件链接");
    await mounted?.unmount();
    const filtered = await render(createElement(LinkTable, { ...props, links: [], filtered: true }));
    expect(filtered.textContent).toContain("没有符合筛选的链接");
  });
});
