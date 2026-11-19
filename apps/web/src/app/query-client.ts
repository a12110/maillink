import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/queries";

// 不自动重试、不在窗口聚焦时重取：失败要立刻就地显示，由用户点“重试”
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

/** 登出 / 会话失效：丢掉所有与登录用户相关的缓存，只保留不依赖会话的公开数据，并把会话标成“未登录” */
export function clearSessionCache(client: QueryClient = queryClient): void {
  const publicKeys: ReadonlyArray<readonly string[]> = [queryKeys.publicConfig, queryKeys.setupStatus];
  void client.cancelQueries();
  client.removeQueries({
    predicate: (query) => !publicKeys.some((key) => key[0] === query.queryKey[0]),
  });
  client.setQueryData(queryKeys.session, null);
}
