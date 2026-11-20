// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminShareLink, LinkAccessView } from "@maillink/shared";
import { queryKeys } from "../../api/queries";
import { makePublicConfig } from "../../test/fixtures";
import { click, mount } from "../../test/render";
import type { Mounted } from "../../test/render";
import { ToastProvider } from "../../ui";
import { accessWithApi, apiCodeUrl, apiCodeUrlFromLink, curlExample } from "./api-code";
import { AccessStep } from "./CreateAccessStep";
import { buildCreateBody, EMPTY_DRAFT } from "./create-form";
import type { CreateDraft } from "./create-form";
import { ApiSection } from "./PanelApi";

const ORIGIN = "https://mail.example.test";
const FULL_TOKEN = "Rj8S3JZ7ibwWM_LlwwHeOCYOIcFayXGKyODuP0ccqgM";

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

async function render(element: ReturnType<typeof createElement>): Promise<HTMLElement> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.publicConfig, makePublicConfig({ turnstile: { enabled: false, site_key: "", scopes: [] } }));
  mounted = await mount(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, element)));
  return mounted.container;
}

const baseAccess: LinkAccessView = { has_password: false, turnstile: false, max_devices: 2, reveal: "click", max_deliveries_total: 5, ip_allow: ["203.0.113.0/24"], country_allow: ["CN"], poll_interval_sec: 15, api: true };

function makeLink(access: Partial<LinkAccessView> = {}, overrides: Partial<AdminShareLink> = {}): AdminShareLink {
  return {
    id: 7,
    name: "订单 A1",
    order_ref: null,
    public_title: null,
    public_note: null,
    token_hint: FULL_TOKEN.slice(0, 6),
    rule_group: { id: 1, name: "仅验证码" },
    status: "active",
    state: "active",
    valid_from: null,
    expires_at: null,
    expire_after_first_access_sec: null,
    effective_expires_at: null,
    access: { ...baseAccess, ...access },
    anchor_reset_at: null,
    first_access_at: null,
    last_access_at: null,
    mailboxes: [{ id: 1, address: "a@icloud.com", status: "active" }],
    device_count: 0,
    country_count: 0,
    deliveries_24h: 0,
    deliveries_total: 0,
    anomalies: [],
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

describe("接口地址与 curl 示例", () => {
  it("由完整链接推出接口地址；不是 /s/<token> 时为 null", () => {
    expect(apiCodeUrl(ORIGIN, FULL_TOKEN)).toBe(`${ORIGIN}/api/s/${FULL_TOKEN}/code`);
    expect(apiCodeUrlFromLink(`${ORIGIN}/s/${FULL_TOKEN}`)).toBe(`${ORIGIN}/api/s/${FULL_TOKEN}/code`);
    expect(apiCodeUrlFromLink(`${ORIGIN}/admin/links`)).toBeNull();
  });

  it("示例总带 X-MailLink-Api 头；有口令时再带 X-Link-Password 头（占位）", () => {
    expect(curlExample("U", false)).toBe("curl -s -H 'X-MailLink-Api: 1' 'U'");
    expect(curlExample("U", true)).toBe("curl -s -H 'X-MailLink-Api: 1' -H 'X-Link-Password: <口令>' 'U'");
  });

  it("开关的请求体：原样带回其余约束，只改 api，不带 password", () => {
    const body = accessWithApi(baseAccess, false);
    expect(body).toEqual({ turnstile: false, max_devices: 2, reveal: "click", max_deliveries_total: 5, max_deliveries_per_day: undefined, ip_allow: ["203.0.113.0/24"], country_allow: ["CN"], poll_interval_sec: 15, api: false });
    expect("password" in body).toBe(false);
  });
});

describe("创建表单：允许 API 取码", () => {
  function Harness({ onDraft }: { onDraft: (draft: CreateDraft) => void }) {
    const [draft, setDraft] = useState(EMPTY_DRAFT);
    onDraft(draft);
    return createElement(AccessStep, { draft, errors: {}, onChange: (patch: Partial<CreateDraft>) => setDraft((current) => ({ ...current, ...patch })) });
  }

  it("默认开并附说明；取消勾选后请求体 api=false", async () => {
    let latest = EMPTY_DRAFT;
    const root = await render(createElement(Harness, { onDraft: (draft: CreateDraft) => { latest = draft; } }));
    const label = Array.from(root.querySelectorAll("label.check-row")).find((item) => item.textContent?.includes("允许 API 取码"));
    const box = label?.querySelector("input") as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(label?.textContent).toContain("接口占 1 台设备");
    const ready = { ...EMPTY_DRAFT, mailboxes: [{ id: 1, address: "a@x.com" }], ruleGroupId: 3 };
    const on = buildCreateBody(ready, 0);
    expect(on.ok && on.body.access?.api).toBe(true);
    await click(box);
    expect(latest.api).toBe(false);
    const off = buildCreateBody({ ...ready, api: latest.api }, 0);
    expect(off.ok && off.body.access?.api).toBe(false);
  });
});

describe("侧板：API 取码", () => {
  it("显示占位接口地址与 curl 示例，不出现完整 token；无口令时示例不带口令头", async () => {
    const root = await render(createElement(ApiSection, { link: makeLink(), origin: ORIGIN }));
    expect(root.textContent).toContain(`GET ${ORIGIN}/api/s/<token>/code`);
    expect(root.querySelector("pre.api-curl")?.textContent).toBe(`curl -s -H 'X-MailLink-Api: 1' '${ORIGIN}/api/s/<token>/code'`);
    expect(root.textContent).toContain("不要把接口地址贴进聊天软件；调用需带 X-MailLink-Api: 1 头。");
    expect(root.textContent).not.toContain(FULL_TOKEN);
    expect(root.textContent).not.toContain("X-Link-Password");
    expect((root.querySelector('input[role="switch"]') as HTMLInputElement).checked).toBe(true);
  });

  it("有口令：示例带口令头并提示 base64 头；开了人机验证时提示接口不可用", async () => {
    const root = await render(createElement(ApiSection, { link: makeLink({ has_password: true, turnstile: true }), origin: ORIGIN }));
    expect(root.querySelector("pre.api-curl")?.textContent).toBe(`curl -s -H 'X-MailLink-Api: 1' -H 'X-Link-Password: <口令>' '${ORIGIN}/api/s/<token>/code'`);
    expect(root.textContent).toContain("X-Link-Password-Base64");
    expect(root.textContent).toContain("turnstile_required");
  });

  it("关闭开关：PATCH 整个 access（api=false、不含口令）", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(makeLink({ api: false })), { status: 200, headers: { "Content-Type": "application/json" } }));
    const root = await render(createElement(ApiSection, { link: makeLink(), origin: ORIGIN }));
    await click(root.querySelector('input[role="switch"]') as HTMLInputElement);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/links/7");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(String(init.body)) as { access: Record<string, unknown> };
    expect(body.access).toMatchObject({ api: false, reveal: "click", max_deliveries_total: 5, max_devices: 2, poll_interval_sec: 15 });
    expect("password" in body.access).toBe(false);
  });

  it("已撤销：开关禁用", async () => {
    const root = await render(createElement(ApiSection, { link: makeLink({}, { status: "revoked", state: "revoked" }), origin: ORIGIN }));
    expect((root.querySelector('input[role="switch"]') as HTMLInputElement).disabled).toBe(true);
  });
});
