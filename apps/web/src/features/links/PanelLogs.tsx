import { useInfiniteQuery } from "@tanstack/react-query";
import type { LinkLog } from "@maillink/shared";
import { linkLogsQuery } from "../../api/links-queries";
import { describeUserAgent, formatFullDateTime } from "../../lib/format";
import { describeError } from "../../lib/messages";
import { Button, ErrorCallout, Tag } from "../../ui";
import { EVENT_LABEL, describeReason } from "./labels";

function LogRow({ log }: { log: LinkLog }) {
  const reason = describeReason(log.reason);
  return (
    <li className="log-row">
      <div className="log-line">
        <span className="mono log-time">{formatFullDateTime(log.created_at)}</span>
        <Tag tone={log.event === "denied" ? "danger" : undefined}>{EVENT_LABEL[log.event]}</Tag>
      </div>
      <div className="log-meta">
        <span className="mono">{log.ip ?? "—"}</span>
        <span>{log.country ?? "—"}</span>
        <span title={log.user_agent ?? undefined}>{describeUserAgent(log.user_agent)}</span>
      </div>
      {reason !== "" ? <div className="log-reason">{reason}</div> : null}
    </li>
  );
}

/** 访问日志：时间、IP、国家、事件、被拒原因（具体原因只给管理员看） */
export function LogsSection({ linkId }: { linkId: number }) {
  const logs = useInfiniteQuery(linkLogsQuery(linkId));
  const items = logs.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="panel-section" aria-labelledby="link-logs">
      <h3 className="section-title" id="link-logs">访问日志</h3>
      {logs.isError ? <ErrorCallout title="访问日志加载失败" {...describeError(logs.error)} onRetry={() => void logs.refetch()} /> : null}
      {logs.isPending ? <span className="skeleton" aria-label="加载中" /> : null}
      {logs.data && items.length === 0 ? <p className="section-lead">还没有访问记录。买家第一次打开链接并点“开始取码”后会出现在这里。</p> : null}
      <ul className="log-list">
        {items.map((log) => (
          <LogRow key={log.id} log={log} />
        ))}
      </ul>
      {logs.hasNextPage ? (
        <Button size="sm" onClick={() => void logs.fetchNextPage()} busy={logs.isFetchingNextPage} busyLabel="加载中…">
          加载更多
        </Button>
      ) : null}
    </section>
  );
}
