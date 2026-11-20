import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { mailboxTagSchema } from "@maillink/shared";
import type { MailboxStatus } from "@maillink/shared";
import { adminMailboxesQuery, adminMailboxTagsQuery } from "../../api/queries";
import { MAILBOXES_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "../../constants";
import { describeError } from "../../lib/messages";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";

export type LinkFilter = "" | "with" | "without";
export type MailboxFilters = { q: string; tag: string; status: MailboxStatus | ""; link: LinkFilter };
export const NO_MAILBOX_FILTERS: MailboxFilters = { q: "", tag: "", status: "", link: "" };

export function linkFilterToQuery(link: LinkFilter): boolean | undefined {
  return link === "" ? undefined : link === "with";
}

/** 标签筛选框是自由输入：不合法的标签不发请求，由界面提示 */
export function parseTagFilter(tag: string): { value: string | undefined; error: string | null } {
  const trimmed = tag.trim();
  if (trimmed === "") return { value: undefined, error: null };
  const parsed = mailboxTagSchema.safeParse(trimmed);
  return parsed.success ? { value: parsed.data, error: null } : { value: undefined, error: parsed.error.issues[0]?.message ?? "标签不合法" };
}

/** 页头摘要：启用 / 已停用各多少（一个不带筛选、limit=1 的列表请求，读响应里的 active_count / disabled_count） */
function useStatusTotals() {
  const all = useQuery(adminMailboxesQuery({ limit: 1 }));
  return { active: all.data?.active_count ?? null, disabled: all.data?.disabled_count ?? null };
}

/** 筛选 + 游标分页。游标栈：第 i 项是第 i+1 页的 cursor（第 1 页没有）；上一页 = 出栈 */
export function useMailboxList() {
  const [filters, setFilters] = useState<MailboxFilters>(NO_MAILBOX_FILTERS);
  const [cursors, setCursors] = useState<string[]>([]);
  const q = useDebouncedValue(filters.q.trim(), SEARCH_DEBOUNCE_MS);
  const tagInput = useDebouncedValue(filters.tag, SEARCH_DEBOUNCE_MS);
  const tag = parseTagFilter(tagInput);
  const query = { q: q || undefined, tag: tag.value, status: filters.status || undefined, has_link: linkFilterToQuery(filters.link), cursor: cursors.at(-1), limit: MAILBOXES_PAGE_SIZE };
  const list = useQuery(adminMailboxesQuery(query));
  const tags = useQuery(adminMailboxTagsQuery());
  const totals = useStatusTotals();
  const nextCursor = list.data?.next_cursor ?? null;
  return {
    list,
    filters,
    filtered: query.q !== undefined || tag.value !== undefined || query.status !== undefined || query.has_link !== undefined,
    tagError: parseTagFilter(filters.tag).error,
    tags: tags.data ?? null,
    tagsError: tags.isError ? describeError(tags.error) : null,
    retryTags: () => void tags.refetch(),
    totals,
    page: cursors.length + 1,
    hasNext: nextCursor !== null,
    activeQuery: { q: query.q, tag: query.tag, status: query.status, has_link: query.has_link },
    changeFilters: (next: MailboxFilters) => {
      setFilters(next);
      setCursors([]);
    },
    turnPage: (direction: -1 | 1) => {
      if (direction === 1 && nextCursor) setCursors([...cursors, nextCursor]);
      if (direction === -1) setCursors(cursors.slice(0, -1));
    },
  };
}
