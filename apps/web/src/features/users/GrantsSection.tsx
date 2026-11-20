import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminGrant, AdminUserDetail } from "@maillink/shared";
import { api } from "../../api/instance";
import { queryKeys } from "../../api/queries";
import { authQueryKeys, userGrantsQuery } from "../../api/queries-auth";
import { formatDateTime } from "../../lib/format";
import { describeError } from "../../lib/messages";
import { Button, Callout, ConfirmDialog, ErrorCallout, Tag, useToast } from "../../ui";
import { GrantAddDialog } from "./GrantAddDialog";
import { GrantEditDialog } from "./GrantEditDialog";
import { grantStatus } from "./grant-form";

type Dialog = { kind: "add" } | { kind: "edit"; grant: AdminGrant } | { kind: "delete"; grant: AdminGrant } | null;

function GrantRow({ grant, onEdit, onDelete }: { grant: AdminGrant; onEdit: () => void; onDelete: () => void }) {
  const status = grantStatus(grant);
  return (
    <li>
      <div className="grant-head">
        <span className="grant-address">{grant.address}</span>
        <Tag tone={status.tone}>{status.label}</Tag>
      </div>
      <div className="grant-meta">
        <span>规则组：{grant.rule_group_name ?? "完整访问"}</span>
        <span>过期：{grant.expires_at === null ? "不过期" : formatDateTime(grant.expires_at)}</span>
        <span>首次访问：{grant.first_access_at === null ? "还没有" : formatDateTime(grant.first_access_at)}</span>
      </div>
      <div className="form-actions">
        <Button size="sm" onClick={onEdit}>修改</Button>
        <Button size="sm" variant="danger-ghost" onClick={onDelete}>删除</Button>
      </div>
    </li>
  );
}

function useDeleteGrant(onDone: () => void) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: number) => api.deleteGrant(id),
    onSuccess: async () => {
      toast.success("授权已删除");
      onDone();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: authQueryKeys.grants }),
        queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
      ]);
    },
  });
}

function Dialogs({ dialog, user, remove, onClose }: { dialog: Dialog; user: AdminUserDetail; remove: ReturnType<typeof useDeleteGrant>; onClose: () => void }) {
  if (dialog?.kind === "add") return <GrantAddDialog userId={user.id} username={user.username} onClose={onClose} />;
  if (dialog?.kind === "edit") return <GrantEditDialog grant={dialog.grant} onClose={onClose} />;
  if (dialog?.kind === "delete") {
    return (
      <ConfirmDialog open onOpenChange={(open) => !open && onClose()} title={`收回 ${dialog.grant.address} 的授权？`}
        consequence={`${user.username} 将立刻看不到这个地址的邮件。已有的邮件不会被删除，之后可以重新授权。`}
        confirmLabel="收回授权" busyLabel="处理中…" busy={remove.isPending}
        error={remove.isError ? describeError(remove.error) : null} onConfirm={() => remove.mutate(dialog.grant.id)} />
    );
  }
  return null;
}

export function GrantsSection({ user }: { user: AdminUserDetail }) {
  const list = useInfiniteQuery(userGrantsQuery(user.id));
  const [dialog, setDialog] = useState<Dialog>(null);
  const remove = useDeleteGrant(() => setDialog(null));
  const grants = list.data?.pages.flatMap((page) => page.items) ?? [];
  const isAdmin = user.role === "admin";

  return (
    <section className="panel-section" aria-labelledby="grants-title">
      <div className="section-row">
        <h3 className="section-title" id="grants-title">邮箱授权</h3>
        <Button size="sm" disabled={isAdmin} onClick={() => setDialog({ kind: "add" })}>添加授权</Button>
      </div>
      <p className="section-lead">
        共 {user.mailbox_grant_count} 个（含失效）。{isAdmin ? "管理员能看到全部邮件，不需要授权。" : "授权决定用户在“我的邮件”里能看到哪些地址。"}
      </p>
      {list.isError ? <ErrorCallout title="授权列表加载失败" {...describeError(list.error)} onRetry={() => void list.refetch()} /> : null}
      {list.data && grants.length === 0 ? <Callout title="还没有授权">{isAdmin ? "管理员不需要授权。" : "点“添加授权”给这个用户分配收件地址。"}</Callout> : null}
      {grants.length > 0 ? (
        <ul className="grant-list" aria-label="授权列表">
          {grants.map((grant) => (
            <GrantRow key={grant.id} grant={grant} onEdit={() => setDialog({ kind: "edit", grant })}
              onDelete={() => { remove.reset(); setDialog({ kind: "delete", grant }); }} />
          ))}
        </ul>
      ) : null}
      {list.hasNextPage ? (
        <Button size="sm" busy={list.isFetchingNextPage} busyLabel="加载中…" onClick={() => void list.fetchNextPage()}>加载更多</Button>
      ) : null}
      <Dialogs dialog={dialog} user={user} remove={remove} onClose={() => setDialog(null)} />
    </section>
  );
}
