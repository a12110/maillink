import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setUnauthorizedHandler } from "../api/instance";
import { ThemeIssueBanner } from "../shell/ThemeIssueBanner";
import { createThemeIssueStore, startTheme } from "../theme";
import { ToastProvider } from "../ui";
import { queryClient } from "./query-client";
import { createAppRouter } from "./router";
import { createUnauthorizedHandler } from "./session-expiry";

const router = createAppRouter();

export function bootstrap(): void {
  // 主题启动不会抛错：问题进入 store，由页面顶部的提示块呈现，应用照常渲染
  const themeIssues = createThemeIssueStore();
  startTheme(themeIssues.report);
  setUnauthorizedHandler(createUnauthorizedHandler(router, queryClient));
  const root = document.getElementById("root");
  if (!root) throw new Error("缺少 #root 节点");
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeIssueBanner store={themeIssues} />
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
