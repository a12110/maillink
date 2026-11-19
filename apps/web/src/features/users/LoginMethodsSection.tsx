import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminUser } from "@maillink/shared";
import { api } from "../../api/instance";
import { describeError } from "../../lib/messages";
import { Button, ConfirmDialog, useToast } from "../../ui";
import { ResetPasswordDialog } from "./ResetPasswordDialog";

function MethodList({ methods }: { methods: AdminUser["login_methods"] }) {
  return (
    <dl className="kv">
      <dt>密码</dt>
      <dd>{methods.password ? "已设置" : "未设置"}</dd>
      <dt>两步验证</dt>
      <dd>{methods.totp ? "已启用" : "未启用"}</dd>
      <dt>通行密钥</dt>
      <dd>{methods.passkey_count > 0 ? `${methods.passkey_count} 把` : "无"}</dd>
      <dt>第三方账号</dt>
      <dd>{methods.oauth_providers.length > 0 ? methods.oauth_providers.join("、") : "无"}</dd>
    </dl>
  );
}

/** 本里程碑只有“重置密码”与“强制下线”；2FA / 通行密钥 / OAuth 的清除随 M5 提供 */
export function LoginMethodsSection({ user }: { user: AdminUser }) {
  const toast = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const revoke = useMutation({
    mutationFn: () => api.revokeUserSessions(user.id),
    onSuccess: ({ revoked }) => {
      toast.success(`已强制 ${user.username} 下线（注销 ${revoked} 个会话）`);
      setRevokeOpen(false);
    },
  });
  return (
    <section className="panel-section" aria-labelledby="methods-title">
      <h3 className="section-title" id="methods-title">登录方式</h3>
      <MethodList methods={user.login_methods} />
      <div className="form-actions">
        <Button onClick={() => setResetOpen(true)}>重置密码</Button>
        <Button onClick={() => { revoke.reset(); setRevokeOpen(true); }}>强制下线</Button>
      </div>
      <p className="section-lead">两步验证、通行密钥与第三方账号的清除将在后续里程碑提供。</p>
      <ResetPasswordDialog open={resetOpen} onOpenChange={setResetOpen} userId={user.id} username={user.username} />
      <ConfirmDialog open={revokeOpen} onOpenChange={setRevokeOpen} title={`强制 ${user.username} 下线？`}
        consequence="该用户的全部会话会失效，所有设备都需要重新登录。" confirmLabel="强制下线" busyLabel="处理中…"
        busy={revoke.isPending} error={revoke.isError ? describeError(revoke.error) : null}
        onConfirm={() => revoke.mutate()} />
    </section>
  );
}
