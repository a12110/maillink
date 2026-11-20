import { useMutation } from "@tanstack/react-query";
import type { FormEvent } from "react";
import type { MeResponse } from "@maillink/shared";
import { isApiError } from "../../api/errors";
import { api } from "../../api/instance";
import { describeAuthError } from "../../lib/auth-messages";
import { Button, ErrorCallout, FormDialog } from "../../ui";
import { ReauthFields, useReauth } from "./ReauthFields";
import type { ReauthBody } from "./reauth";

export type OAuthLinkProvider = { slug: string; name: string };

type Props = {
  me: MeResponse;
  provider: OAuthLinkProvider;
  /** 拿到提供方授权地址后整页跳转（默认 location.assign，测试里替换） */
  redirect: (url: string) => void;
  onClose: () => void;
};

const REAUTH_ERRORS = ["reauth_failed", "reauth_required"];

function LinkForm({ me, provider, redirect, onClose }: Props) {
  // 绑上的第三方账号可以直接登录（默认不要求本地 2FA）：发起前必须再确认，口径同添加通行密钥
  const reauth = useReauth({ hasPassword: me.has_password, totpEnabled: me.totp_enabled, allowRecentSession: true });
  const start = useMutation({
    mutationFn: (body: ReauthBody) => api.startOAuthLink(provider.slug, body),
    onSuccess: (result) => redirect(result.authorize_url),
    onError: (error) => {
      if (isApiError(error) && REAUTH_ERRORS.includes(error.code)) reauth.setServerError(error.message);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = reauth.collect();
    if (body !== null) start.mutate(body);
  };
  const handled = isApiError(start.error) && REAUTH_ERRORS.includes(start.error.code);
  // 成功后页面即将离开：按钮保持忙碌，避免重复发起
  const leaving = start.isPending || start.isSuccess;
  return (
    <form className="dialog-form" onSubmit={submit} noValidate>
      <ReauthFields controller={reauth} idPrefix={`oauth-link-${provider.slug}`} />
      {start.isError && !handled ? <ErrorCallout title="无法发起绑定" {...describeAuthError(start.error)} /> : null}
      <div className="dialog-actions">
        <Button onClick={onClose} disabled={leaving}>取消</Button>
        <Button type="submit" variant="primary" busy={leaving} busyLabel="正在跳转…">继续并跳转</Button>
      </div>
    </form>
  );
}

/** 绑定第三方账号：再确认 → POST 发起 → 整页跳转到提供方 */
export function OAuthLinkDialog(props: Props) {
  const { name } = props.provider;
  return (
    <FormDialog open onOpenChange={(open) => !open && props.onClose()} title={`绑定 ${name}`}
      description={`确认是你本人后会跳转到 ${name} 授权，完成后回到本页。绑定后可以用这个 ${name} 账号直接登录。`}>
      <LinkForm {...props} />
    </FormDialog>
  );
}
