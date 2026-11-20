import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isApiError } from "../api/errors";
import { queryKeys } from "../api/queries";

/**
 * 任一接口返回 403 admin_2fa_required（系统要求管理员启用两步验证而本会话还没有）：
 * 让会话缓存失效重取，外壳据此显示引导条（会话接口会带出 admin_2fa_required）。
 */
function watchAdmin2fa(client: () => QueryClient) {
  return (error: unknown) => {
    if (isApiError(error, "admin_2fa_required")) void client().invalidateQueries({ queryKey: queryKeys.session });
  };
}

// 不自动重试、不在窗口聚焦时重取：失败要立刻就地显示，由用户点“重试”
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: watchAdmin2fa(() => client) }),
    mutationCache: new MutationCache({ onError: watchAdmin2fa(() => client) }),
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return client;
}

export const queryClient = createQueryClient();

/** 登出 / 会话失效：丢掉所有与登录用户相关的缓存，只保留不依赖会话的公开数据，并把会话标成“未登录” */
export function clearSessionCache(client: QueryClient = queryClient): void {
  const publicKeys: ReadonlyArray<readonly string[]> = [queryKeys.publicConfig, queryKeys.setupStatus];
  void client.cancelQueries();
  client.removeQueries({
    predicate: (query) => !publicKeys.some((key) => key[0] === query.queryKey[0]),
  });
  client.setQueryData(queryKeys.session, null);
}
