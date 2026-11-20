import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import type { AdminShareLink, ShareLinkListQuery } from "@maillink/shared";
import { adminLinksQuery, linkKeys } from "../../api/links-queries";
import { LINKS_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "../../constants";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { describeError } from "../../lib/messages";
import { PageHeader } from "../../shell/PageHeader";
import { useToast } from "../../ui";
import { clearHandoff, resolveHandoff } from "./create-handoff";
import { LinkDialogs } from "./LinkDialogs";
import type { DialogState } from "./LinkDialogs";
import { LinkPanel } from "./LinkPanel";
import type { LinkAction } from "./LinkPanel";
import { LinkTable } from "./LinkTable";
import { BatchBar, LinkToolbar } from "./LinkToolbar";
import type { BatchKind } from "./LinkToolbar";
import { filtersFromSearch, hasLinkFilters, NO_LINK_FILTERS } from "./search";
import type { LinkFilters } from "./search";
import { useCursorStack } from "./useCursorStack";

const routeApi = getRouteApi("/workspace/admin/links");

function toQuery(filters: LinkFilters, q: string, orderRef: string, cursor: string | undefined): ShareLinkListQuery {
  return {
    q: q || undefined,
    order_ref: orderRef || undefined,
    state: filters.state || undefined,
    rule_group_id: filters.ruleGroupId ?? undefined,
    mailbox_id: filters.mailboxId ?? undefined,
    cursor,
    limit: LINKS_PAGE_SIZE,
  };
}

function useLinkList() {
  const search = routeApi.useSearch();
  const [filters, setFilters] = useState<LinkFilters>(() => filtersFromSearch(search));
  const pages = useCursorStack();
  const q = useDebouncedValue(filters.q.trim(), SEARCH_DEBOUNCE_MS);
  const orderRef = useDebouncedValue(filters.orderRef.trim(), SEARCH_DEBOUNCE_MS);
  const list = useQuery(adminLinksQuery(toQuery(filters, q, orderRef, pages.cursor)));
  return {
    list,
    filters,
    pages,
    createFor: search.create_for,
    filtered: hasLinkFilters({ ...filters, q, orderRef }),
    changeFilters: (next: LinkFilters) => {
      setFilters(next);
      pages.reset();
    },
  };
}

/** 侧板里的单条操作 → 对话框（暂停 / 恢复不需要确认，直接执行） */
function dialogForAction(action: LinkAction, link: AdminShareLink): DialogState {
  if (action === "pause" || action === "resume") return { kind: "quick", action, ids: [link.id] };
  if (action === "extend" || action === "revoke") return { kind: action, ids: [link.id] };
  return { kind: action, link };
}

/** 批量条 → 对话框 */
function dialogForBatch(kind: BatchKind, ids: number[]): DialogState {
  if (kind === "pause" || kind === "resume") return { kind: "quick", action: kind, ids };
  if (kind === "set_rule_group") return { kind: "ruleGroup", ids };
  return { kind, ids };
}

/** 关闭创建对话框（含完成）时清掉 URL 里的 create_for 与地址交接，刷新不再弹窗 */
function useCloseDialog(dialog: DialogState | null, hasCreateFor: boolean, close: () => void): () => void {
  const navigate = routeApi.useNavigate();
  return () => {
    if (dialog?.kind === "create") {
      clearHandoff();
      if (hasCreateFor) void navigate({ search: (previous) => ({ ...previous, create_for: undefined }), replace: true });
    }
    close();
  };
}

/** 勾选：跨页保留；“选择本页全部”只动当前页 */
function useSelection(links: AdminShareLink[] | undefined) {
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  return {
    checked,
    clear: () => setChecked(new Set()),
    toggle: (id: number) => setChecked((current) => new Set(current.has(id) ? [...current].filter((value) => value !== id) : [...current, id])),
    toggleAll: () => {
      const ids = (links ?? []).map((link) => link.id);
      setChecked((current) => (ids.every((id) => current.has(id)) ? new Set([...current].filter((id) => !ids.includes(id))) : new Set([...current, ...ids])));
    },
  };
}

/** 取件链接管理（05 §3）：工具栏 + 表格 + 详情侧板；批量条与工具栏同一位置互换 */
export function LinksPage() {
  const state = useLinkList();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { list, filters, pages } = state;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [autoPreview, setAutoPreview] = useState(false);
  const links = list.data?.items;
  const { checked, toggle, toggleAll, clear: clearSelection } = useSelection(links);
  const [dialog, setDialog] = useState<DialogState | null>(state.createFor ? { kind: "create", preselected: resolveHandoff(state.createFor) } : null);
  const closeDialog = useCloseDialog(dialog, state.createFor !== undefined, () => setDialog(null));
  const titles = new Map((links ?? []).map((link) => [link.id, link]));

  const refresh = () => void queryClient.invalidateQueries({ queryKey: linkKeys.all });
  const closePanel = () => {
    const id = selectedId;
    setSelectedId(null);
    if (id !== null) document.querySelector<HTMLElement>(`[data-link-id="${id}"]`)?.focus();
  };

  const onAction = (action: LinkAction, link: AdminShareLink) => setDialog(dialogForAction(action, link));
  const onBatch = (kind: BatchKind) => setDialog(dialogForBatch(kind, [...checked]));
  const preview = (link: AdminShareLink) => {
    setSelectedId(link.id);
    setAutoPreview(true);
  };

  return (
    <>
      <PageHeader title="取件链接" summary={list.data ? [<span key="n" className="num">共 {list.data.total} 条链接</span>] : undefined} />
      <div className="split" data-panel={selectedId === null ? "closed" : "open"}>
        <div className="table-scope">
          {checked.size > 0 ? (
            <BatchBar count={checked.size} busy={false} onAction={onBatch} onClear={clearSelection} />
          ) : (
            <LinkToolbar filters={filters} onChange={state.changeFilters} onCreate={() => setDialog({ kind: "create", preselected: [] })} />
          )}
          <LinkTable
            links={links}
            loading={list.isFetching}
            error={list.isError ? describeError(list.error) : null}
            filtered={state.filtered}
            page={pages.page}
            hasNext={list.data?.next_cursor != null}
            selectedId={selectedId}
            checked={checked}
            onSelect={setSelectedId}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onCopy={(link) => setDialog({ kind: "copy", link })}
            onPreview={preview}
            onPage={(direction) => (direction === -1 ? pages.back() : list.data?.next_cursor && pages.forward(list.data.next_cursor))}
            onRetry={() => void list.refetch()}
            onClearFilters={() => state.changeFilters(NO_LINK_FILTERS)}
            onCreate={() => setDialog({ kind: "create", preselected: [] })}
          />
        </div>
        {selectedId !== null ? (
          <LinkPanel key={selectedId} linkId={selectedId} autoPreview={autoPreview} onAutoPreviewDone={() => setAutoPreview(false)} onClose={closePanel} onAction={onAction} />
        ) : null}
      </div>
      <LinkDialogs
        dialog={dialog}
        labelOf={(id) => (titles.get(id) ? (titles.get(id)?.name ?? titles.get(id)?.order_ref ?? `#${id}`) : `#${id}`)}
        onClose={closeDialog}
        onChanged={(message) => {
          refresh();
          if (message) toast.success(message);
        }}
      />
    </>
  );
}
