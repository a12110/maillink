import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { SessionResponse } from "@maillink/shared";
import { sessionQuery, setupStatusQuery } from "../api/queries";

const PICKUP_PATH_PREFIX = "/s/";

export type RouterContext = { queryClient: QueryClient };

/** 根守卫：需要初始化时任何页面都跳 /setup；已初始化后 /setup 无意义（后端永久 404），跳 /login */
export async function guardSetup({ context, location }: { context: RouterContext; location: { pathname: string } }) {
  // 取件页（/s/:token）是对外入口：链接不可能早于初始化存在，不依赖初始化检查（省一次往返，其失败也不该拦住买家）
  if (location.pathname.startsWith(PICKUP_PATH_PREFIX)) return;
  const { needs_setup } = await context.queryClient.ensureQueryData(setupStatusQuery());
  const onSetup = location.pathname === "/setup";
  if (needs_setup && !onSetup) throw redirect({ to: "/setup" });
  if (!needs_setup && onSetup) throw redirect({ to: "/login" });
}

export async function loadSession(context: RouterContext): Promise<SessionResponse | null> {
  return context.queryClient.ensureQueryData(sessionQuery());
}

/** 工作区：必须已登录，否则去 /login */
export async function requireSession(context: RouterContext): Promise<SessionResponse> {
  const session = await loadSession(context);
  if (!session) throw redirect({ to: "/login" });
  return session;
}

/** /admin/*：非管理员跳回 /inbox */
export async function requireAdminSession(context: RouterContext): Promise<void> {
  const session = await requireSession(context);
  if (session.user.role !== "admin") throw redirect({ to: "/inbox" });
}

/** 登录页：已登录就按角色去首页 */
export async function redirectIfSignedIn(context: RouterContext): Promise<void> {
  const session = await loadSession(context);
  if (session) throw redirect({ to: homeFor(session) });
}

export function homeFor(session: SessionResponse): "/admin/mailboxes" | "/inbox" {
  return session.user.role === "admin" ? "/admin/mailboxes" : "/inbox";
}

/** `/`：管理员 → /admin/mailboxes，用户 → /inbox，未登录 → /login */
export async function redirectFromRoot(context: RouterContext): Promise<never> {
  const session = await loadSession(context);
  throw redirect({ to: session ? homeFor(session) : "/login" });
}
