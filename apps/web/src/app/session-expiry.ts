import type { QueryClient } from "@tanstack/react-query";
import { clearSessionCache } from "./query-client";
import type { createAppRouter } from "./router";

type AppRouter = ReturnType<typeof createAppRouter>;

/** 会话失效（任一接口 401）：清会话缓存并跳 /login；已经在 /login 时不重复跳，避免循环 */
export function createUnauthorizedHandler(router: AppRouter, client: QueryClient): () => void {
  return () => {
    clearSessionCache(client);
    if (router.state.location.pathname !== "/login") void router.navigate({ to: "/login" });
  };
}
