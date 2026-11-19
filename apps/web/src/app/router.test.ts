// @vitest-environment happy-dom
// 为什么需要 DOM 环境：TanStack Router 在 node 条件下按“服务端”构建加载，不会执行客户端导航；
// 手工桩出 document / self / window 后，路由级的 navigate()（如 401 跳转）仍走不通，所以用 happy-dom。
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionResponse } from "@maillink/shared";
import { queryKeys } from "../api/queries";
import { retryRoute } from "../shell/retry";
import { createAppRouter } from "./router";
import { createUnauthorizedHandler } from "./session-expiry";

function session(role: "admin" | "user"): SessionResponse {
  return { user: { id: 1, username: "u", display_name: null, email: null, role }, auth_methods: ["password"], expires_at: 1 };
}

/** 用预置缓存模拟后端状态，真实跑一遍路由树的 beforeLoad 链，返回最终落点 */
async function landAt(path: string, state: { session: SessionResponse | null; needsSetup?: boolean }): Promise<string> {
  const client = new QueryClient();
  client.setQueryData(queryKeys.session, state.session);
  client.setQueryData(queryKeys.setupStatus, { needs_setup: state.needsSetup ?? false });
  const router = createAppRouter({ client, history: createMemoryHistory({ initialEntries: ["/__start"] }) });
  await router.navigate({ to: path });
  return router.state.location.pathname;
}

describe("路由树守卫（真实路由树 + 内存 history）", () => {
  it("/ 按角色跳转", async () => {
    expect(await landAt("/", { session: session("admin") })).toBe("/admin/mailboxes");
    expect(await landAt("/", { session: session("user") })).toBe("/inbox");
    expect(await landAt("/", { session: null })).toBe("/login");
  });

  it("未登录访问工作区页面 → /login", async () => {
    expect(await landAt("/admin/users", { session: null })).toBe("/login");
    expect(await landAt("/account", { session: null })).toBe("/login");
    expect(await landAt("/inbox", { session: null })).toBe("/login");
  });

  it("非管理员访问 /admin/* → /inbox；管理员正常进入", async () => {
    expect(await landAt("/admin/users", { session: session("user") })).toBe("/inbox");
    expect(await landAt("/admin/settings/site", { session: session("user") })).toBe("/inbox");
    expect(await landAt("/admin/users", { session: session("admin") })).toBe("/admin/users");
    expect(await landAt("/account", { session: session("user") })).toBe("/account");
  });

  it("/admin 与 /admin/settings 有默认落点", async () => {
    expect(await landAt("/admin", { session: session("admin") })).toBe("/admin/mailboxes");
    expect(await landAt("/admin/settings", { session: session("admin") })).toBe("/admin/settings/site");
  });

  it("已登录访问 /login → 回到各自首页", async () => {
    expect(await landAt("/login", { session: session("admin") })).toBe("/admin/mailboxes");
    expect(await landAt("/login", { session: session("user") })).toBe("/inbox");
  });

  it("需要初始化时任何页面都进 /setup", async () => {
    for (const path of ["/", "/login", "/admin/users", "/s/abc", "/inbox"]) {
      expect(await landAt(path, { session: null, needsSetup: true })).toBe("/setup");
    }
  });

  it("已初始化后 /setup → /login；取件页不要求登录", async () => {
    expect(await landAt("/setup", { session: null })).toBe("/login");
    expect(await landAt("/s/abc", { session: null })).toBe("/s/abc");
  });
});

describe("出错后重试与会话失效", () => {
  afterEach(() => vi.unstubAllGlobals());

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  it("beforeLoad 请求失败后，retryRoute 重新发请求并恢复", async () => {
    let healthy = false;
    const fetchMock = vi.fn(async () =>
      healthy ? jsonResponse({ needs_setup: false }) : new Response("bad gateway", { status: 502 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.session, null);
    const router = createAppRouter({ client, history: createMemoryHistory({ initialEntries: ["/login"] }) });

    await router.load();
    expect(router.state.matches.some((m) => m.status === "error")).toBe(true);
    const callsBefore = fetchMock.mock.calls.length;

    healthy = true;
    const reset = vi.fn();
    await retryRoute(router, reset);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(router.state.matches.some((m) => m.status === "error")).toBe(false);
    expect(router.state.location.pathname).toBe("/login");
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("会话失效（401）：清缓存并跳 /login；已在 /login 时不再跳", async () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.session, session("admin"));
    client.setQueryData(queryKeys.setupStatus, { needs_setup: false });
    client.setQueryData([...queryKeys.adminUsers, "list"], { items: [], next_cursor: null });
    const router = createAppRouter({ client, history: createMemoryHistory({ initialEntries: ["/admin/users"] }) });
    await router.load();
    expect(router.state.location.pathname).toBe("/admin/users");

    const onUnauthorized = createUnauthorizedHandler(router, client);
    onUnauthorized();
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(client.getQueryData(queryKeys.session)).toBeNull();
    expect(client.getQueryData([...queryKeys.adminUsers, "list"])).toBeUndefined();
    expect(client.getQueryData(queryKeys.setupStatus)).toEqual({ needs_setup: false });

    const entries = router.history.length;
    onUnauthorized();
    await Promise.resolve();
    expect(router.history.length).toBe(entries);
  });
});
