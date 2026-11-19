import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { AdminUserListQuery } from "@maillink/shared";
import { SESSION_STALE_MS } from "../constants";
import { api } from "./instance";

// 查询键集中在这里；失效与清缓存都靠前缀匹配
export const queryKeys = {
  setupStatus: ["setup-status"] as const,
  publicConfig: ["public-config"] as const,
  session: ["session"] as const,
  me: ["me"] as const,
  mySessions: ["me", "sessions"] as const,
  adminUsers: ["admin", "users"] as const,
};

/** 初始化一旦完成就永不再变；仍需要初始化时每次都重新问 */
export const setupStatusQuery = () =>
  queryOptions({
    queryKey: queryKeys.setupStatus,
    queryFn: api.setupStatus,
    staleTime: (query) => (query.state.data?.needs_setup === false ? Infinity : 0),
  });

export const publicConfigQuery = () =>
  queryOptions({ queryKey: queryKeys.publicConfig, queryFn: api.publicConfig, staleTime: SESSION_STALE_MS });

export const sessionQuery = () =>
  queryOptions({ queryKey: queryKeys.session, queryFn: api.session, staleTime: SESSION_STALE_MS });

export const meQuery = () => queryOptions({ queryKey: queryKeys.me, queryFn: api.me });

export const mySessionsQuery = () => queryOptions({ queryKey: queryKeys.mySessions, queryFn: api.mySessions });

export const adminUsersQuery = (query: AdminUserListQuery) =>
  queryOptions({
    queryKey: [...queryKeys.adminUsers, "list", query] as const,
    queryFn: () => api.listUsers(query),
    placeholderData: keepPreviousData,
  });

export const adminUserQuery = (id: number) =>
  queryOptions({ queryKey: [...queryKeys.adminUsers, "detail", id] as const, queryFn: () => api.getUser(id) });
