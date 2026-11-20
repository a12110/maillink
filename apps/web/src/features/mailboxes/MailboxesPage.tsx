import { useState } from "react";
import type { AdminMailbox, MailboxStatus } from "@maillink/shared";
import { MAILBOXES_PAGE_SIZE } from "../../constants";
import { describeError } from "../../lib/messages";
import { PageHeader } from "../../shell/PageHeader";
import { BatchLayer } from "./BatchLayer";
import { EditMailboxDialog } from "./EditMailboxDialog";
import { ImportDialog } from "./ImportDialog";
import { MailboxTable } from "./MailboxTable";
import { MailboxToolbar } from "./MailboxToolbar";
import { NO_MAILBOX_FILTERS, useMailboxList } from "./useMailboxList";
import { useMailboxSelection } from "./useMailboxSelection";

type Totals = { active: number | null; disabled: number | null };

/** 页头摘要：共 N 个 · 启用 · 已停用；后两项可点作状态筛选 */
function Summary({ totals, onStatus }: { totals: Totals; onStatus: (status: MailboxStatus) => void }) {
  const sum = totals.active !== null && totals.disabled !== null ? totals.active + totals.disabled : null;
  return (
    <>
      <span>共 <b className="num">{sum ?? "…"}</b> 个地址</span>
      <button type="button" className="summary-filter" onClick={() => onStatus("active")}>启用 <b className="num">{totals.active ?? "…"}</b></button>
      <button type="button" className="summary-filter" onClick={() => onStatus("disabled")}>已停用 <b className="num">{totals.disabled ?? "…"}</b></button>
    </>
  );
}

export function MailboxesPage() {
  const state = useMailboxList();
  const selection = useMailboxSelection();
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<AdminMailbox | null>(null);
  const { list } = state;
  const toolbar = (
    <MailboxToolbar filters={state.filters} tags={state.tags} tagError={state.tagError} onChange={state.changeFilters} onImport={() => setImporting(true)} />
  );
  return (
    <>
      <PageHeader title="收件地址" summary={<Summary totals={state.totals} onStatus={(status) => state.changeFilters({ ...NO_MAILBOX_FILTERS, status })} />} />
      <div className="table-scope">
        <BatchLayer selection={selection} total={list.data?.total} activeQuery={state.activeQuery} toolbar={toolbar} />
        <MailboxTable
          items={list.data?.items}
          total={list.data?.total}
          loading={list.isFetching}
          error={list.isError ? describeError(list.error) : null}
          filtered={state.filtered}
          page={state.page}
          pageSize={MAILBOXES_PAGE_SIZE}
          hasNext={state.hasNext}
          selection={selection}
          onEdit={setEditing}
          onPage={state.turnPage}
          onRetry={() => void list.refetch()}
          onClearFilters={() => state.changeFilters(NO_MAILBOX_FILTERS)}
          onImport={() => setImporting(true)}
        />
      </div>
      <ImportDialog open={importing} onOpenChange={setImporting} />
      <EditMailboxDialog mailbox={editing} onClose={() => setEditing(null)} />
    </>
  );
}
