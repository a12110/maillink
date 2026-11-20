import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { adminUsersQuery } from "../../api/queries";
import { SEARCH_DEBOUNCE_MS, USERS_PAGE_SIZE } from "../../constants";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { describeError } from "../../lib/messages";
import { PageHeader } from "../../shell/PageHeader";
import { CreateUserDialog } from "./CreateUserDialog";
import { UserPanel } from "./UserPanel";
import { UserTable } from "./UserTable";
import { UserToolbar } from "./UserToolbar";
import type { UserFilters } from "./UserToolbar";

const NO_FILTERS: UserFilters = { q: "", role: "", status: "" };

/** 筛选 + 游标分页。游标栈：第 i 项是第 i+1 页的 cursor（第 1 页没有）；上一页 = 出栈 */
function useUserList() {
  const [filters, setFilters] = useState<UserFilters>(NO_FILTERS);
  const [cursors, setCursors] = useState<string[]>([]);
  const q = useDebouncedValue(filters.q.trim(), SEARCH_DEBOUNCE_MS);
  const list = useQuery(
    adminUsersQuery({
      q: q || undefined,
      role: filters.role || undefined,
      status: filters.status || undefined,
      cursor: cursors.at(-1),
      limit: USERS_PAGE_SIZE,
    }),
  );
  const nextCursor = list.data?.next_cursor ?? null;
  return {
    list,
    filters,
    filtered: q !== "" || filters.role !== "" || filters.status !== "",
    page: cursors.length + 1,
    hasNext: nextCursor !== null,
    changeFilters: (next: UserFilters) => {
      setFilters(next);
      setCursors([]);
    },
    turnPage: (direction: -1 | 1) => {
      if (direction === 1 && nextCursor) setCursors([...cursors, nextCursor]);
      if (direction === -1) setCursors(cursors.slice(0, -1));
    },
  };
}

export function UsersPage() {
  const state = useUserList();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const { list } = state;

  // 关闭侧板后焦点回到打开它的那一行（键盘用户不丢位置）；行已不存在（如刚删除）则不处理
  const closePanel = () => {
    const id = selectedId;
    setSelectedId(null);
    if (id !== null) document.querySelector<HTMLElement>(`[data-user-id="${id}"]`)?.focus();
  };

  return (
    <>
      <PageHeader title="用户" />
      <div className="split" data-panel={selectedId === null ? "closed" : "open"}>
        <div className="table-scope">
          <UserToolbar filters={state.filters} onChange={state.changeFilters} onCreate={() => setCreating(true)} />
          <UserTable
            users={list.data?.items}
            loading={list.isFetching}
            error={list.isError ? describeError(list.error) : null}
            filtered={state.filtered}
            page={state.page}
            hasNext={state.hasNext}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onPage={state.turnPage}
            onRetry={() => void list.refetch()}
            onClearFilters={() => state.changeFilters(NO_FILTERS)}
          />
        </div>
        {selectedId !== null ? <UserPanel key={selectedId} userId={selectedId} onClose={closePanel} /> : null}
      </div>
      <CreateUserDialog open={creating} onOpenChange={setCreating} onCreated={setSelectedId} />
    </>
  );
}
