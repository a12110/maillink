import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { SessionResponse } from "@maillink/shared";
import { queryKeys } from "../api/queries";
import { guardSetup, homeFor, redirectFromRoot, redirectIfSignedIn, requireAdminSession, requireSession } from "./guards";

function session(role: "admin" | "user"): SessionResponse {
  return { user: { id: 1, username: "u", display_name: null, email: null, role }, auth_methods: ["password"], expires_at: 1 };
}

function contextWith(data: { session?: SessionResponse | null; needsSetup?: boolean }) {
  const queryClient = new QueryClient();
  if (data.session !== undefined) queryClient.setQueryData(queryKeys.session, data.session);
  if (data.needsSetup !== undefined) queryClient.setQueryData(queryKeys.setupStatus, { needs_setup: data.needsSetup });
  return { queryClient };
}

/** TanStack 的 redirect() 抛出的是带 options.to 的对象 */
async function redirectTarget(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const to = (error as { options?: { to?: string } }).options?.to;
    if (to === undefined) throw error;
    return to;
  }
}

describe("路由守卫", () => {
  it("需要初始化：任何页面都跳 /setup，/setup 本身放行", async () => {
    const context = contextWith({ needsSetup: true });
    expect(await redirectTarget(() => guardSetup({ context, location: { pathname: "/login" } }))).toBe("/setup");
    expect(await redirectTarget(() => guardSetup({ context, location: { pathname: "/admin/users" } }))).toBe("/setup");
    expect(await redirectTarget(() => guardSetup({ context, location: { pathname: "/setup" } }))).toBeNull();
  });

  it("已初始化：/setup 跳 /login，其他页面放行", async () => {
    const context = contextWith({ needsSetup: false });
    expect(await redirectTarget(() => guardSetup({ context, location: { pathname: "/setup" } }))).toBe("/login");
    expect(await redirectTarget(() => guardSetup({ context, location: { pathname: "/inbox" } }))).toBeNull();
  });

  it("/ 按角色跳转", async () => {
    expect(await redirectTarget(() => redirectFromRoot(contextWith({ session: session("admin") })))).toBe("/admin/mailboxes");
    expect(await redirectTarget(() => redirectFromRoot(contextWith({ session: session("user") })))).toBe("/inbox");
    expect(await redirectTarget(() => redirectFromRoot(contextWith({ session: null })))).toBe("/login");
  });

  it("工作区要求登录；/admin/* 要求管理员", async () => {
    expect(await redirectTarget(() => requireSession(contextWith({ session: null })))).toBe("/login");
    expect(await redirectTarget(() => requireSession(contextWith({ session: session("user") })))).toBeNull();
    expect(await redirectTarget(() => requireAdminSession(contextWith({ session: session("user") })))).toBe("/inbox");
    expect(await redirectTarget(() => requireAdminSession(contextWith({ session: session("admin") })))).toBeNull();
    expect(await redirectTarget(() => requireAdminSession(contextWith({ session: null })))).toBe("/login");
  });

  it("已登录访问 /login 时按角色回到首页", async () => {
    expect(await redirectTarget(() => redirectIfSignedIn(contextWith({ session: session("user") })))).toBe("/inbox");
    expect(await redirectTarget(() => redirectIfSignedIn(contextWith({ session: null })))).toBeNull();
    expect(homeFor(session("admin"))).toBe("/admin/mailboxes");
  });
});
