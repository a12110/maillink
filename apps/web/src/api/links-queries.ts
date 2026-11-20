import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { AdminMailboxListQuery, ShareLinkListQuery } from "@maillink/shared";
import { LINK_LOGS_PAGE_SIZE } from "../constants";
import { api } from "./instance";

// 取件链接管理的查询键与查询。失效靠前缀匹配：invalidate(linkKeys.all) 刷新列表、详情、日志。
export const linkKeys = {
  all: ["admin", "links"] as const,
  ruleGroups: ["admin", "rule-groups", "choices"] as const,
  mailboxes: ["admin", "mailboxes", "picker"] as const,
};

export const adminLinksQuery = (query: ShareLinkListQuery) =>
  queryOptions({
    queryKey: [...linkKeys.all, "list", query] as const,
    queryFn: () => api.listLinks(query),
    placeholderData: keepPreviousData,
  });

export const adminLinkQuery = (id: number) =>
  queryOptions({ queryKey: [...linkKeys.all, "detail", id] as const, queryFn: () => api.getLink(id) });

export const linkLogsQuery = (id: number) =>
  infiniteQueryOptions({
    queryKey: [...linkKeys.all, "logs", id] as const,
    queryFn: ({ pageParam }) => api.linkLogs(id, { cursor: pageParam, limit: LINK_LOGS_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

export const linkRuleGroupChoicesQuery = () =>
  queryOptions({ queryKey: linkKeys.ruleGroups, queryFn: api.listRuleGroupChoices });

export const mailboxPickerQuery = (query: AdminMailboxListQuery) =>
  queryOptions({
    queryKey: [...linkKeys.mailboxes, query] as const,
    queryFn: () => api.listMailboxes(query),
    placeholderData: keepPreviousData,
  });
