import { useQuery } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { sessionQuery } from "../api/queries";
import { Admin2faRequiredPage } from "./Admin2faNotice";

/** /admin/* 的布局：会话要求先启用两步验证时不渲染子页（它们的接口都会 403） */
export function AdminLayout() {
  const session = useQuery(sessionQuery()).data;
  return session?.admin_2fa_required === true ? <Admin2faRequiredPage /> : <Outlet />;
}
