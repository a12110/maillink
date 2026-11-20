import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { mailboxTagSchema } from "@maillink/shared";
import type { AdminMailbox, MailboxStatus } from "@maillink/shared";
import { adminMailboxesQuery } from "../../api/queries";
import { MAILBOXES_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "../../constants";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";

export type MailboxFilters = { q: string; tag: string; status: MailboxStatus | "" };
export const NO_MAILBOX_FILTERS: MailboxFilters = { q: "", tag: "", status: "" };

/** 标签筛选框是自由输入：不合法的标签不发请求，由界面提示 */
export function parseTagFilter(tag: string): { value: string | undefined; error: string | null } {
  const trimmed = tag.trim();
  if (trimmed === "") return { value: undefined, error: null };
  const parsed = mailboxTagSchema.safeParse(trimmed);
  return parsed.success ? { value: parsed.data, error: null } : { value: undefined, error: parsed.error.issues[0]?.message ?? "标签不合法" };
}

/** 页头摘要：启用 / 已停用各多少（各发一个 limit=1 的列表请求取 total，不带搜索与标签） */
function useStatusTotals() {
  const active = useQuery(adminMailboxesQuery({ status: "active", limit: 1 }));
  const disabled = useQuery(adminMailboxesQuery({ status: "disabled", limit: 1 }));
  return { active: active.data?.total ?? null, disabled: disabled.data?.total ?? null };
}

/** 页面里出现过的标签，给筛选框的候选（后端没有“全部标签”接口） */
function useKnownTags(items: readonly AdminMailbox[] | undefined): string[] {
  const [known, setKnown] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!items) return;
    setKnown((current) => {
      const next = new Set(current);
      for (const item of items) for (const tag of item.tags) next.add(tag);
      return next.size === current.size ? current : next;
    });
  }, [items]);
  return [...known].sort();
}

/** 筛选 + 游标分页。游标栈：第 i 项是第 i+1 页的 cursor（第 1 页没有）；上一页 = 出栈 */
export function useMailboxList() {
  const [filters, setFilters] = useState<MailboxFilters>(NO_MAILBOX_FILTERS);
  const [cursors, setCursors] = useState<string[]>([]);
  const q = useDebouncedValue(filters.q.trim(), SEARCH_DEBOUNCE_MS);
  const tagInput = useDebouncedValue(filters.tag, SEARCH_DEBOUNCE_MS);
  const tag = parseTagFilter(tagInput);
  const query = { q: q || undefined, tag: tag.value, status: filters.status || undefined, cursor: cursors.at(-1), limit: MAILBOXES_PAGE_SIZE };
  const list = useQuery(adminMailboxesQuery(query));
  const knownTags = useKnownTags(list.data?.items);
  const totals = useStatusTotals();
  const nextCursor = list.data?.next_cursor ?? null;
  return {
    list,
    filters,
    filtered: query.q !== undefined || tag.value !== undefined || query.status !== undefined,
    tagError: parseTagFilter(filters.tag).error,
    knownTags,
    totals,
    page: cursors.length + 1,
    hasNext: nextCursor !== null,
    activeQuery: { q: query.q, tag: query.tag, status: query.status },
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
