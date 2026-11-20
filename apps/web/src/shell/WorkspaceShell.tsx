import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api/instance";
import { sessionQuery } from "../api/queries";
import { clearSessionCache } from "../app/query-client";
import { DESKTOP_MEDIA_QUERY } from "../constants";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { describeError } from "../lib/messages";
import { Button, ErrorCallout } from "../ui";
import { Admin2faBanner } from "./Admin2faNotice";
import { BrandMark, SiteName } from "./Brand";
import { SidebarContent } from "./Sidebar";

function useLogout() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      clearSessionCache();
      await navigate({ to: "/login" });
    },
  });
}

/** 窄屏抽屉：Radix Dialog（焦点陷阱、Esc 关闭），回到桌面宽度时自动收起 */
function NavDrawer({ open, onOpenChange, children }: { open: boolean; onOpenChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="drawer" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">主导航</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 工作区外壳：侧栏 + 内容区（05 §2）。<1024px 侧栏变为抽屉 */
export function WorkspaceShell() {
  const { data: session } = useQuery(sessionQuery());
  const logout = useLogout();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);

  useEffect(() => {
    if (isDesktop) setDrawerOpen(false);
  }, [isDesktop]);

  // 路由守卫保证进入工作区时必有会话；会话被清掉的瞬间（登出中）不渲染
  if (!session) return null;
  const sidebar = (onNavigate?: () => void) => (
    <SidebarContent user={session.user} loggingOut={logout.isPending} onLogout={() => logout.mutate()} onNavigate={onNavigate} />
  );
  return (
    <div className="app">
      <aside className="sidebar">{sidebar()}</aside>
      <header className="topbar">
        <Button variant="ghost" iconOnly aria-label="打开导航" onClick={() => setDrawerOpen(true)}>
          <Menu />
        </Button>
        <span className="brand">
          <BrandMark />
          <SiteName />
        </span>
      </header>
      <NavDrawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        {sidebar(() => setDrawerOpen(false))}
      </NavDrawer>
      <main className="main" id="main">
        {session.admin_2fa_required === true ? <Admin2faBanner /> : null}
        {logout.isError ? (
          <ErrorCallout title="退出登录失败" {...describeError(logout.error)} onRetry={() => logout.mutate()} />
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
