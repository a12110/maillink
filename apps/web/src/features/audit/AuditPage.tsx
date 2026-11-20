import { useInfiniteQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../api/instance";
import { queryKeys } from "../../api/queries";
import { AUDIT_PAGE_SIZE } from "../../constants";
import { describeError } from "../../lib/messages";
import { PageHeader } from "../../shell/PageHeader";
import { Button, EmptyState, ErrorCallout } from "../../ui";
import { AuditFilters, NO_AUDIT_FILTERS } from "./AuditFilters";
import type { AuditFilterDraft } from "./AuditFilters";
import { hasAuditFilters, toAuditQuery } from "./audit-state";
import { AuditTable } from "./AuditTable";

function useAuditLogs(filters: AuditFilterDraft) {
  const { query, error } = useMemo(() => toAuditQuery(filters), [filters]);
  const logs = useInfiniteQuery({
    queryKey: [...queryKeys.adminAudit, query] as const,
    queryFn: ({ pageParam }) => api.listAuditLogs({ ...query, cursor: pageParam, limit: AUDIT_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: error === null,
  });
  return { logs, rangeError: error, items: logs.data?.pages.flatMap((page) => page.items) };
}

function Body({ state, filtered, onClear }: { state: ReturnType<typeof useAuditLogs>; filtered: boolean; onClear: () => void }) {
  const { logs, items } = state;
  if (logs.isError && !items) {
    return <div className="card-pad"><ErrorCallout title="审计日志加载失败" {...describeError(logs.error)} onRetry={() => void logs.refetch()} /></div>;
  }
  if (items?.length === 0) {
    return filtered ? (
      <EmptyState icon={ScrollText} title="没有符合筛选的日志" description="放宽动作或时间范围再看看。" action={<Button onClick={onClear}>清除筛选</Button>} />
    ) : (
      <EmptyState icon={ScrollText} title="还没有审计日志" description="登录、用户管理、规则组与收件地址的变更都会记录在这里。" />
    );
  }
  return <AuditTable logs={items} />;
}

export function AuditPage() {
  const [filters, setFilters] = useState<AuditFilterDraft>(NO_AUDIT_FILTERS);
  const state = useAuditLogs(filters);
  const { logs, items } = state;
  const filtered = hasAuditFilters(filters);
  return (
    <>
      <PageHeader title="审计日志" summary={items ? <span>已加载 <b className="num">{items.length}</b> 条{logs.hasNextPage ? "，还有更早的" : ""}</span> : null} />
      <div className="table-scope">
        <AuditFilters filters={filters} rangeError={state.rangeError} onChange={setFilters} />
        <div className="panel">
          <Body state={state} filtered={filtered} onClear={() => setFilters(NO_AUDIT_FILTERS)} />
          {items && items.length > 0 ? (
            <div className="table-foot">
              {logs.isError ? <span className="field-error">加载更多失败：{describeError(logs.error).message}</span> : <span className="num">{logs.hasNextPage ? "还有更早的日志" : "已到最早一条"}</span>}
              <Button size="sm" disabled={!logs.hasNextPage} busy={logs.isFetchingNextPage} busyLabel="加载中…" onClick={() => void logs.fetchNextPage()}>加载更多</Button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
