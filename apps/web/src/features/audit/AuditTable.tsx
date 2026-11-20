import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { AuditLog } from "@maillink/shared";
import { formatFullDateTime } from "../../lib/format";
import { SkeletonRows, Tag } from "../../ui";
import { expandJsonStrings } from "./audit-state";
import { actionLabel, reasonLabel, targetLabel } from "./labels";

const SKELETON_ROWS = 8;
const COLUMN_COUNT = 6;

function Actor({ log }: { log: AuditLog }) {
  if (log.actor_username !== null) return <span className="mono">{log.actor_username}</span>;
  if (log.actor_user_id !== null) return <span className="dim" title="该用户已被删除，日志保留">已删除用户 #{log.actor_user_id}</span>;
  return <span className="dim" title="登录失败等没有已确认身份的事件">—（无执行者）</span>;
}

function Target({ log }: { log: AuditLog }) {
  const text = targetLabel(log.target_type, log.target_id);
  if (text === null) return <span className="dim">—</span>;
  if (log.target_type === "rule_group" && log.target_id !== null && /^\d+$/u.test(log.target_id)) {
    return <Link className="row-link" to="/admin/rule-groups/$id" params={{ id: log.target_id }}>{text}</Link>;
  }
  return <>{text}</>;
}

function DetailRow({ log }: { log: AuditLog }) {
  const reason = reasonLabel(log.detail);
  return (
    <tr className="audit-detail-row">
      <td colSpan={COLUMN_COUNT}>
        {reason === null ? null : <p className="field-hint">原因：{reason}</p>}
        <pre className="audit-detail" tabIndex={0} aria-label={`日志 ${log.id} 的详情 JSON`}>{JSON.stringify(expandJsonStrings(log.detail), null, 2)}</pre>
      </td>
    </tr>
  );
}

function LogRow({ log }: { log: AuditLog }) {
  const [open, setOpen] = useState(false);
  const hasDetail = log.detail !== null;
  return (
    <>
      <tr data-open={open}>
        <td className="time">{formatFullDateTime(log.created_at)}</td>
        <td title={log.action}><span className="audit-action-name">{actionLabel(log.action)}</span>{" "}<Tag><span className="mono">{log.action}</span></Tag></td>
        <td className="col-optional"><Actor log={log} /></td>
        <td className="col-optional"><Target log={log} /></td>
        <td className="col-secondary mono-cell">{log.ip ?? <span className="dim">—</span>}</td>
        <td className="col-actions">
          {hasDetail ? (
            <button type="button" className="row-link" aria-expanded={open} aria-label={`${open ? "收起" : "展开"}日志 ${log.id} 的详情`} onClick={() => setOpen(!open)}>
              {open ? <ChevronDown /> : <ChevronRight />}详情
            </button>
          ) : <span className="dim">无详情</span>}
        </td>
      </tr>
      {open && hasDetail ? <DetailRow log={log} /> : null}
    </>
  );
}

export function AuditTable({ logs }: { logs: AuditLog[] | undefined }) {
  return (
    <table className="table audit-table">
      <colgroup>
        <col data-w="xl" />
        <col />
        <col className="col-optional" data-w="md" />
        <col className="col-optional" data-w="lg" />
        <col className="col-secondary" data-w="md" />
        <col data-w="md" />
      </colgroup>
      <thead>
        <tr>
          <th>时间</th><th>动作</th><th className="col-optional">执行者</th><th className="col-optional">目标</th><th className="col-secondary">IP</th><th><span className="sr-only">详情</span></th>
        </tr>
      </thead>
      <tbody>{logs ? logs.map((log) => <LogRow key={log.id} log={log} />) : <SkeletonRows rows={SKELETON_ROWS} columns={COLUMN_COUNT} />}</tbody>
    </table>
  );
}
