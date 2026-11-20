import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";
import { describeError } from "../../lib/messages";
import { Callout, ConfirmDialog, ErrorCallout } from "../../ui";
import { saveHandoff } from "../links/create-handoff";
import { deleteConsequence, SELECT_ALL_LIMIT } from "./batch-state";
import type { BatchFailure } from "./batch-state";
import { MailboxBatchBar } from "./MailboxToolbar";
import { GrantUsersDialog } from "./GrantUsersDialog";
import { TagBatchDialog } from "./TagBatchDialog";
import type { TagMode } from "./TagBatchDialog";
import { useMailboxBatch } from "./useMailboxBatch";
import type { Selection } from "./useMailboxSelection";
import { useSelectAll } from "./useSelectAll";

function FailureNotice({ failures, onDismiss }: { failures: BatchFailure[]; onDismiss: () => void }) {
  if (failures.length === 0) return null;
  return (
    <Callout tone="danger" title={`${failures.length} 个地址没有处理成功`} actions={<button type="button" className="text-action" onClick={onDismiss}>知道了</button>}>
      {failures.slice(0, 5).map((f) => `${f.address}：${f.reason}`).join("；")}
      {failures.length > 5 ? `；另有 ${failures.length - 5} 个` : ""}
    </Callout>
  );
}

function GrantSlot({ open, mailboxes, onClose }: { open: boolean; mailboxes: Selection["selected"]; onClose: () => void }) {
  return open ? <GrantUsersDialog mailboxes={mailboxes} onClose={onClose} /> : null;
}

/** 「生成取件链接」：地址 id 进 URL（create_for），地址文本走 sessionStorage 交接，链接页的创建对话框据此预选 */
function useCreateLinks(selection: Selection): () => void {
  const navigate = useNavigate();
  return () => {
    saveHandoff([...selection.selected.values()]);
    void navigate({ to: "/admin/links", search: { create_for: [...selection.selected.keys()] } });
  };
}

type Props = {
  selection: Selection;
  total: number | undefined;
  activeQuery: { q?: string; tag?: string; status?: "active" | "disabled"; has_link?: boolean };
  /** 没有选中项时显示的默认工具栏 */
  toolbar: ReactNode;
};

/** 工具栏位置：无选择时是默认工具栏，选中后换成批量条；批量相关的对话框与失败提示都在这一层 */
export function BatchLayer({ selection, total, activeQuery, toolbar }: Props) {
  const batch = useMailboxBatch(selection);
  const selectAll = useSelectAll(selection, activeQuery);
  const [tagMode, setTagMode] = useState<TagMode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [granting, setGranting] = useState(false);
  const count = selection.selected.size;
  const busy = batch.mutation.isPending;
  const batchError = batch.mutation.isError ? describeError(batch.mutation.error) : null;
  const ids = () => [...selection.selected.keys()];
  const createLinks = useCreateLinks(selection);
  const closeTag = () => {
    setTagMode(null);
    batch.mutation.reset();
  };
  const closeDelete = () => {
    setDeleting(false);
    batch.mutation.reset();
  };
  return (
    <>
      {count > 0 ? (
        <MailboxBatchBar
          count={count}
          total={total ?? null}
          limit={SELECT_ALL_LIMIT}
          tooMany={(total ?? 0) > SELECT_ALL_LIMIT}
          allSelected={total !== undefined && count >= total}
          walking={selectAll.walking}
          busy={busy}
          onSelectAll={selectAll.run}
          onCreateLinks={createLinks}
          onGrant={() => setGranting(true)}
          onTag={setTagMode}
          onSetStatus={(status) => batch.mutation.mutate({ ids: ids(), action: status === "active" ? "enable" : "disable" })}
          onDelete={() => setDeleting(true)}
          onClear={selection.clear}
        />
      ) : (
        toolbar
      )}
      <div className="page-notices">
        <FailureNotice failures={batch.failures} onDismiss={batch.dismissFailures} />
        {batchError && !deleting && tagMode === null ? <ErrorCallout title="批量操作失败" {...batchError} /> : null}
        {selectAll.error ? <ErrorCallout title="选择全部失败" {...selectAll.error} /> : null}
      </div>
      <TagBatchDialog
        mode={tagMode}
        count={count}
        busy={busy}
        error={batchError}
        onClose={closeTag}
        onSubmit={(mode, tags) => batch.mutation.mutate({ ids: ids(), action: mode === "add" ? "add_tags" : "remove_tags", tags }, { onSuccess: closeTag })}
      />
      <GrantSlot open={granting} mailboxes={selection.selected} onClose={() => setGranting(false)} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={(open) => (open ? setDeleting(true) : closeDelete())}
        title={`删除 ${count} 个收件地址？`}
        consequence={deleteConsequence(selection.selected)}
        confirmLabel="删除地址"
        busyLabel="删除中…"
        busy={busy}
        error={batchError}
        onConfirm={() => batch.mutation.mutate({ ids: ids(), action: "delete" }, { onSuccess: () => setDeleting(false) })}
      />
    </>
  );
}
