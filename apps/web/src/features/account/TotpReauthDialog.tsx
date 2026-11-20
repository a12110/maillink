import { useMutation } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { isApiError } from "../../api/errors";
import { api } from "../../api/instance";
import { describeAuthError } from "../../lib/auth-messages";
import { Button, ErrorCallout, FormDialog } from "../../ui";
import { ReauthFields, useReauth } from "./ReauthFields";
import type { ReauthBody } from "./reauth";

export type TotpAction = "disable" | "regenerate";

type Props = {
  action: TotpAction;
  hasPassword: boolean;
  onClose: () => void;
  /** 关闭 2FA 成功 */
  onDisabled: () => void;
  /** 重新生成成功，带新的明文恢复码 */
  onRegenerated: (codes: string[]) => void;
};

const COPY: Record<TotpAction, { title: string; description: string; submit: string; busy: string; variant: "danger" | "primary" }> = {
  disable: {
    title: "关闭两步验证",
    description: "关闭后只靠密码保护账号，所有恢复码作废，你在其他设备上的登录会话会失效。请先确认是你本人。",
    submit: "关闭两步验证",
    busy: "关闭中…",
    variant: "danger",
  },
  regenerate: {
    title: "重新生成恢复码",
    description: "会生成 10 个新的恢复码，之前的恢复码全部作废。请先确认是你本人。",
    submit: "重新生成",
    busy: "生成中…",
    variant: "primary",
  },
};

function Form({ action, hasPassword, onClose, onDisabled, onRegenerated }: Props) {
  const copy = COPY[action];
  // 关闭 2FA 与重新生成恢复码不接受“最近登录”：必须当前密码或 TOTP
  const reauth = useReauth({ hasPassword, totpEnabled: true, allowRecentSession: false });
  const run = useMutation({
    // 重新生成时响应里有明文恢复码：不留在 mutation 缓存里
    gcTime: 0,
    mutationFn: async (body: ReauthBody) => {
      if (action === "disable") {
        await api.totpDisable(body);
        return null;
      }
      return (await api.regenerateRecoveryCodes(body)).recovery_codes;
    },
    onSuccess: (codes) => (codes === null ? onDisabled() : onRegenerated(codes)),
    onError: (error) => {
      if (isApiError(error, "reauth_failed") || isApiError(error, "reauth_required")) reauth.setServerError(error.message);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = reauth.collect();
    if (body !== null) run.mutate(body);
  };
  const handled = isApiError(run.error, "reauth_failed") || isApiError(run.error, "reauth_required");
  return (
    <form className="dialog-form" onSubmit={submit} noValidate>
      <ReauthFields controller={reauth} idPrefix={`totp-${action}`} />
      {run.isError && !handled ? <ErrorCallout title="操作失败" {...describeAuthError(run.error)} /> : null}
      <div className="dialog-actions">
        <Button onClick={onClose} disabled={run.isPending}>取消</Button>
        <Button type="submit" variant={copy.variant} busy={run.isPending} busyLabel={copy.busy}>{copy.submit}</Button>
      </div>
    </form>
  );
}

export function TotpReauthDialog(props: Props) {
  const copy = COPY[props.action];
  return (
    <FormDialog open onOpenChange={(open) => !open && props.onClose()} title={copy.title} description={copy.description}>
      <Form {...props} />
    </FormDialog>
  );
}
