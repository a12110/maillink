import { getRouteApi } from "@tanstack/react-router";
import { Inbox, RefreshCw, X } from "lucide-react";
import { useEffect } from "react";
import { DESKTOP_MEDIA_QUERY } from "../../constants";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { PageHeader } from "../../shell/PageHeader";
import { Button, EmptyState } from "../../ui";
import { MailDetail } from "./MailDetail";
import { MailFilterSection } from "./MailFilterSection";
import { listItems } from "./list-store";
import { MailList } from "./MailList";
import { filtersOf, hasActiveFilters, NO_FILTERS, normalizeFilters } from "./search";
import type { MailFilters } from "./search";
import { useMailList } from "./useMailList";

const routeApi = getRouteApi("/workspace/admin/mails");

/** 管理员“全部邮件”（05 §3）：左列表右详情，窄屏栈式；筛选条件与选中的邮件都同步在 URL 上 */
export function MailsPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const filters = filtersOf(search);
  const selectedId = search.id ?? null;
  const { store, state } = useMailList(filters);

  const setFilters = (next: MailFilters) => void navigate({ search: { ...normalizeFilters(next), id: selectedId ?? undefined }, replace: true });
  const select = (id: number | null) => void navigate({ search: { ...normalizeFilters(filters), id: id ?? undefined } });

  // 窄屏进入详情后回到顶部（详情替换了列表，保留列表的滚动位置没有意义）
  useEffect(() => {
    if (selectedId !== null && !isDesktop) window.scrollTo(0, 0);
  }, [selectedId, isDesktop]);

  return (
    <div className="mail-page" data-view={selectedId === null ? "list" : "detail"}>
      <PageHeader title="全部邮件" />
      <MailFilterSection filters={filters} onChange={setFilters} />
      <div className="mail-split">
        <section className="mail-list-col" aria-label="邮件队列">
          <div className="mail-list-toolbar">
            <span className="num">{state.pages.length > 0 ? `已加载 ${listItems(state).length} 封` : ""}</span>
            <span className="spacer" />
            {hasActiveFilters(filters) ? (
              <Button size="sm" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>
                <X />
                清除筛选
              </Button>
            ) : null}
            <Button size="sm" onClick={() => store.refresh()} busy={state.busy === "first"} busyLabel="刷新中…">
              <RefreshCw />
              刷新
            </Button>
          </div>
          <div className="panel">
            <MailList
            state={state}
            selectedId={selectedId}
            filtered={hasActiveFilters(filters)}
            onSelect={select}
            onLoadMore={() => store.loadMore()}
            onRetry={() => store.retry()}
            onClearFilters={() => setFilters(NO_FILTERS)}
            />
          </div>
        </section>
        <section className="mail-detail-col" aria-label="邮件详情">
          {selectedId === null ? (
            <EmptyState icon={Inbox} title="选择一封邮件" description="在左侧列表里点一封邮件，这里显示它的内容、信封信息与附件。" />
          ) : (
            <MailDetail key={selectedId} id={selectedId} onBack={() => select(null)} />
          )}
        </section>
      </div>
    </div>
  );
}
