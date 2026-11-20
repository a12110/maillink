import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { MAIL_DETAIL_STALE_MS } from "../constants";
import { api } from "./instance";

// 账号安全、授权、我的邮件的查询键与查询（与 queries.ts 分开，减少并行开发时的冲突）。
export const authQueryKeys = {
  myPasskeys: ["me", "passkeys"] as const,
  myIdentities: ["me", "identities"] as const,
  grants: ["admin", "grants"] as const,
  grantPickers: ["admin", "grant-pickers"] as const,
  myMailboxes: ["inbox", "mailboxes"] as const,
  myMail: ["inbox", "mail"] as const,
};

export const myPasskeysQuery = () => queryOptions({ queryKey: authQueryKeys.myPasskeys, queryFn: api.myPasskeys });
export const myIdentitiesQuery = () => queryOptions({ queryKey: authQueryKeys.myIdentities, queryFn: api.myIdentities });

/** 某用户的授权，游标分页（“加载更多”） */
export const userGrantsQuery = (userId: number) =>
  infiniteQueryOptions({
    queryKey: [...authQueryKeys.grants, userId] as const,
    queryFn: ({ pageParam }) => api.listGrants({ user_id: userId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

export const ruleGroupPickerQuery = () =>
  queryOptions({ queryKey: [...authQueryKeys.grantPickers, "rule-groups"] as const, queryFn: api.pickRuleGroups });

/** 授权表单的收件地址选择：按关键词搜索，只取启用中的（停用地址授权了也看不到） */
export const mailboxPickerQuery = (q: string) =>
  queryOptions({
    queryKey: [...authQueryKeys.grantPickers, "mailboxes", q] as const,
    queryFn: () => api.listMailboxes({ q: q === "" ? undefined : q, status: "active", limit: 50 }),
  });

export const myMailboxesQuery = () => queryOptions({ queryKey: authQueryKeys.myMailboxes, queryFn: api.myMailboxes });

export const myMailQuery = (id: number, mailboxId: number | undefined) =>
  queryOptions({
    queryKey: [...authQueryKeys.myMail, id, mailboxId ?? "all"] as const,
    queryFn: () => api.myMail(id, mailboxId),
    staleTime: MAIL_DETAIL_STALE_MS,
  });
