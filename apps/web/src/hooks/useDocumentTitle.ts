import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { publicConfigQuery } from "../api/queries";
import { APP_NAME } from "../constants";

/** 浏览器标题：`页面名 · 站点名称`（站点名称来自 /api/public/config，未加载时先用产品名） */
export function useDocumentTitle(page: string): void {
  const siteName = useQuery(publicConfigQuery()).data?.site_name ?? APP_NAME;
  useEffect(() => {
    document.title = `${page} · ${siteName}`;
  }, [page, siteName]);
}
