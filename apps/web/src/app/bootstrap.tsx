import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setUnauthorizedHandler } from "../api/instance";
import { publicConfigQuery, queryKeys } from "../api/queries";
import { ThemeIssueBanner } from "../shell/ThemeIssueBanner";
import { createThemeIssueStore, startTheme, themeFromAppearance, ThemeControllerProvider } from "../theme";
import type { ThemeController } from "../theme";
import { ToastProvider } from "../ui";
import { queryClient } from "./query-client";
import { createAppRouter } from "./router";
import { createUnauthorizedHandler } from "./session-expiry";

const router = createAppRouter();

/**
 * 主题的服务端来源是 /api/public/config.appearance：启动时取一次，之后缓存里的公开配置每次更新（设置页保存后失效重取）都同步过来。
 * 取不到配置不改变主题（保持默认），错误进主题提示块，页面上用到配置的地方也会各自暴露真实请求错误。
 */
function followPublicConfig(theme: ThemeController, report: (error: unknown) => void): void {
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.query.queryKey[0] !== queryKeys.publicConfig[0]) return;
    const config = queryClient.getQueryData(publicConfigQuery().queryKey);
    if (config !== undefined) theme.update(themeFromAppearance(config.appearance));
  });
  queryClient.fetchQuery(publicConfigQuery()).catch((error: unknown) => report(error));
}

export function bootstrap(): void {
  // 主题启动不会抛错：问题进入 store，由页面顶部的提示块呈现，应用照常渲染
  const themeIssues = createThemeIssueStore();
  const theme = startTheme(themeIssues.report);
  followPublicConfig(theme, themeIssues.report);
  setUnauthorizedHandler(createUnauthorizedHandler(router, queryClient));
  const root = document.getElementById("root");
  if (!root) throw new Error("缺少 #root 节点");
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeIssueBanner store={themeIssues} />
        <ThemeControllerProvider value={theme}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </ThemeControllerProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
