import { Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrandMark, SiteDescription, SiteFooter, SiteName } from "./Brand";

/** 认证页外壳：居中单栏，站点名称、Logo、描述、页脚来自 /api/public/config */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="auth-col">
        <header className="auth-head">
          <div className="auth-brand">
            <BrandMark />
            <SiteName />
          </div>
          <SiteDescription className="auth-desc" />
        </header>
        <main className="card auth-card">{children}</main>
        <SiteFooter className="auth-footer" />
      </div>
    </div>
  );
}

export function AuthShell() {
  return (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  );
}
