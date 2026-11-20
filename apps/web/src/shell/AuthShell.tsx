import { Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrandMark, SiteName } from "./Brand";

/** 认证页外壳：居中单栏，站点名称来自 /api/public/config */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="auth-col">
        <div className="auth-brand">
          <BrandMark />
          <SiteName />
        </div>
        <main className="card auth-card">{children}</main>
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
