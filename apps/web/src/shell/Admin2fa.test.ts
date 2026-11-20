// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionResponse } from "@maillink/shared";
import { ApiError } from "../api/errors";
import { queryKeys } from "../api/queries";
import { createQueryClient } from "../app/query-client";
import { createAppRouter } from "../app/router";
import { describeError } from "../lib/messages";
import { byText, settle } from "../test/dom";
import { installFakeFetch } from "../test/fake-fetch";
import { mount } from "../test/render";
import type { Mounted } from "../test/render";
import { ToastProvider } from "../ui";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

function session(role: "admin" | "user", required: boolean | undefined): SessionResponse {
  return {
    user: { id: 1, username: "root", display_name: null, email: null, role },
    auth_methods: ["password"],
    expires_at: 2_000_000_000,
    ...(required === undefined ? {} : { admin_2fa_required: required }),
  };
}

async function open(url: string, current: SessionResponse) {
  const server = installFakeFetch({
    "GET /api/auth/session": { json: current },
    "GET /api/me": { json: { id: 1, username: "root", display_name: null, email: null, role: current.user.role, has_password: true, totp_enabled: false, recovery_codes_remaining: 0, created_at: 1, last_login_at: null } },
    "GET /api/me/sessions": { json: { items: [] } },
    "GET /api/me/passkeys": { json: { items: [] } },
    "GET /api/me/identities": { json: { items: [] } },
    "GET /api/me/mailboxes": { json: { items: [], next_cursor: null } },
    "GET /api/admin/users": { json: { items: [], next_cursor: null } },
  });
  const client = createQueryClient();
  client.setQueryData(queryKeys.session, current);
  client.setQueryData(queryKeys.setupStatus, { needs_setup: false });
  const router = createAppRouter({ client, history: createMemoryHistory({ initialEntries: [url] }) });
  await router.load();
  mounted = await mount(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(RouterProvider, { router }))));
  await settle();
  return { box: mounted.container, server, client, router };
}

describe("admin_2fa_required：工作区引导", () => {
  it("会话带 admin_2fa_required=true：每个工作区页面顶部有提示条，链接到 /account 的两步验证区", async () => {
    const { box } = await open("/inbox", session("admin", true));
    const banner = box.querySelector(".main > .callout");
    expect(banner?.textContent).toContain("需要先启用两步验证");
    const link = byText(box, ".main > .callout a", "去启用两步验证");
    expect(link.getAttribute("href")).toBe("/account#totp-title");
  });

  it("false 或缺省：没有提示条", async () => {
    expect((await open("/inbox", session("admin", false))).box.querySelector(".main > .callout")).toBeNull();
    await mounted?.unmount();
    mounted = null;
    expect((await open("/inbox", session("admin", undefined))).box.querySelector(".main > .callout")).toBeNull();
  });

  it("/admin/* 页面被引导页替代，不发任何 /api/admin 请求", async () => {
    const { box, server } = await open("/admin/users", session("admin", true));
    expect(box.textContent).toContain("管理功能暂时不可用");
    expect(box.querySelector("table")).toBeNull();
    expect(server.calls.some((call) => call.path.startsWith("/api/admin"))).toBe(false);
  });

  it("没有要求时 /admin/users 正常渲染", async () => {
    const { box, server } = await open("/admin/users", session("admin", false));
    expect(box.textContent).not.toContain("管理功能暂时不可用");
    expect(server.callsTo("GET /api/admin/users").length).toBeGreaterThan(0);
  });
});

describe("403 admin_2fa_required", () => {
  async function fail(client: QueryClient): Promise<void> {
    await client
      .fetchQuery({ queryKey: ["admin", "x"], queryFn: () => Promise.reject(new ApiError(403, "admin_2fa_required", "x")) })
      .catch(() => undefined);
  }

  it("任一查询收到它：会话缓存失效重取（外壳随之出现引导）", async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.session, session("admin", false));
    await fail(client);
    expect(client.getQueryState(queryKeys.session)?.isInvalidated).toBe(true);
  });

  it("其他错误不动会话缓存", async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.session, session("admin", false));
    await client.fetchQuery({ queryKey: ["admin", "y"], queryFn: () => Promise.reject(new ApiError(403, "forbidden", "x")) }).catch(() => undefined);
    expect(client.getQueryState(queryKeys.session)?.isInvalidated).toBe(false);
  });

  it("残留的 403 也说人话并指向账号安全，而不是通用错误", () => {
    const { message, detail } = describeError(new ApiError(403, "admin_2fa_required", "服务端原文"));
    expect(message).toContain("账号安全");
    expect(detail).toBe("admin_2fa_required · HTTP 403");
  });
});
