import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminUserDetail } from "@maillink/shared";
import { api } from "../../api/instance";
import { queryKeys, sessionQuery } from "../../api/queries";
import { describeError } from "../../lib/messages";
import { Button, Callout, ConfirmDialog, useToast } from "../../ui";
import { CredentialRows } from "./CredentialRows";
import { describeRemoval, NO_LOGIN_METHOD_MESSAGE, runRemoval } from "./credential-removal";
import type { Removal } from "./credential-removal";
import { ResetPasswordDialog } from "./ResetPasswordDialog";

function useRemoval(user: AdminUserDetail, isSelf: boolean, onDone: (noLoginMethod: boolean) => void) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (removal: Removal) => runRemoval(api, user.id, removal),
    onSuccess: async (result) => {
      toast.success(result.removed === 0 ? "没有需要清除的凭据" : `已清除 ${result.removed} 项，${user.username} 的 ${result.sessions_revoked} 个会话已失效`);
      onDone(result.no_login_method);
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
      // 清的是自己的凭据（比如 2FA）：会话里的 admin_2fa_required 可能随之变化
      if (isSelf) await queryClient.invalidateQueries({ queryKey: queryKeys.session });
    },
  });
}

export function LoginMethodsSection({ user }: { user: AdminUserDetail }) {
  const toast = useToast();
  const isSelf = useQuery(sessionQuery()).data?.user.id === user.id;
  const [resetOpen, setResetOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [removing, setRemoving] = useState<Removal | null>(null);
  // 响应里的 no_login_method 只在这次清除之后有意义；用户后来有了密码就不再提示
  const [noMethod, setNoMethod] = useState(false);
  const remove = useRemoval(user, isSelf, (none) => {
    setRemoving(null);
    setNoMethod(none);
  });
  const revoke = useMutation({
    mutationFn: () => api.revokeUserSessions(user.id),
    onSuccess: ({ revoked }) => {
      toast.success(`已强制 ${user.username} 下线（注销 ${revoked} 个会话）`);
      setRevokeOpen(false);
    },
  });
  const copy = removing ? describeRemoval(removing, user.username, isSelf) : null;

  return (
    <section className="panel-section" aria-labelledby="methods-title">
      <h3 className="section-title" id="methods-title">登录方式</h3>
      <CredentialRows user={user} onRemove={(removal) => { remove.reset(); setRemoving(removal); }} />
      {noMethod && !user.login_methods.password ? (
        <Callout tone="warning" title={NO_LOGIN_METHOD_MESSAGE}
          actions={<button type="button" className="text-action" onClick={() => setResetOpen(true)}>重置密码</button>}>
          没有密码、通行密钥或已启用提供方的绑定，该用户现在无法登录。
        </Callout>
      ) : null}
      <div className="form-actions">
        <Button onClick={() => setResetOpen(true)}>重置密码</Button>
        <Button onClick={() => { revoke.reset(); setRevokeOpen(true); }}>强制下线</Button>
      </div>
      <ResetPasswordDialog open={resetOpen} onOpenChange={setResetOpen} userId={user.id} username={user.username} />
      <ConfirmDialog open={revokeOpen} onOpenChange={setRevokeOpen} title={`强制 ${user.username} 下线？`}
        consequence="该用户的全部会话会失效，所有设备都需要重新登录。" confirmLabel="强制下线" busyLabel="处理中…"
        busy={revoke.isPending} error={revoke.isError ? describeError(revoke.error) : null}
        onConfirm={() => revoke.mutate()} />
      {removing && copy ? (
        <ConfirmDialog open onOpenChange={(open) => !open && setRemoving(null)} title={copy.title} consequence={copy.consequence}
          confirmLabel={copy.confirmLabel} busyLabel="清除中…" busy={remove.isPending}
          error={remove.isError ? describeError(remove.error) : null} onConfirm={() => remove.mutate(removing)} />
      ) : null}
    </section>
  );
}
