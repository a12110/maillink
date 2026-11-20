// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../api/queries";
import { createAppRouter } from "../../app/router";
import { byText, settle } from "../../test/dom";
import { installFakeFetch } from "../../test/fake-fetch";
import { makePublicConfig } from "../../test/fixtures";
import { testQueryClient } from "../../test/providers";
import { mount } from "../../test/render";
import type { Mounted } from "../../test/render";
import { click } from "../../test/render";
import { ToastProvider } from "../../ui";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const SESSION = { user: { id: 1, username: "alice", display_name: null, email: null, role: "user" as const }, auth_methods: ["password"], expires_at: 2_000_000_000 };

async function openAccount(url: string) {
  installFakeFetch({
    "GET /api/public/config": { json: makePublicConfig({ login_methods: ["password", "oauth"], oauth_providers: [{ slug: "github", name: "GitHub", icon: null }] }) },
    "GET /api/me": { json: { id: 1, username: "alice", display_name: null, email: null, role: "user", has_password: true, totp_enabled: false, recovery_codes_remaining: 0, created_at: 1, last_login_at: null } },
    "GET /api/me/sessions": { json: { items: [] } },
    "GET /api/me/passkeys": { json: { items: [] } },
    "GET /api/me/identities": { json: { items: [] } },
  });
  const client = testQueryClient();
  client.setQueryData(queryKeys.session, SESSION);
  client.setQueryData(queryKeys.setupStatus, { needs_setup: false });
  const router = createAppRouter({ client, history: createMemoryHistory({ initialEntries: [url] }) });
  await router.load();
  mounted = await mount(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(RouterProvider, { router }))));
  await settle();
  return { box: mounted.container, router };
}

describe("账号页：OAuth 回跳结果", () => {
  it("读完即 replace 清掉地址栏参数，结果暂存在页面里；“知道了”关闭", async () => {
    const { box, router } = await openAccount("/account?oauth=identity_taken&provider=github");
    expect(router.state.location.search).toEqual({});
    expect(router.state.location.href).toBe("/account");
    expect(box.querySelector(".page-narrow > .callout")?.textContent).toContain("GitHub：该第三方账号已被其他用户绑定");
    await click(byText(box, ".page-narrow > .callout button", "知道了"));
    expect(box.querySelector(".page-narrow > .callout")).toBeNull();
  });

  it("没有回跳参数时没有提示", async () => {
    const { box } = await openAccount("/account");
    expect(box.querySelector(".page-narrow > .callout")).toBeNull();
  });
});
