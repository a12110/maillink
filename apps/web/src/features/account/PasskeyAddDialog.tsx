import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { passkeyNameSchema, PASSKEY_NAME_MAX_LENGTH } from "@maillink/shared";
import type { MeResponse } from "@maillink/shared";
import { isApiError } from "../../api/errors";
import { api } from "../../api/instance";
import { authQueryKeys } from "../../api/queries-auth";
import { describeWebAuthnError } from "../../lib/webauthn";
import type { WebAuthnClient } from "../../lib/webauthn";
import { Button, ErrorCallout, FormDialog, TextField, useToast } from "../../ui";
import { registerPasskey } from "./passkey-flow";
import { ReauthFields, useReauth } from "./ReauthFields";

type Props = { me: MeResponse; webauthn: WebAuthnClient; onClose: () => void };

const REAUTH_ERRORS = ["reauth_failed", "reauth_required"];

function AddForm({ me, webauthn, onClose }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // 通行密钥是长期凭据：添加前必须再确认（密码 / TOTP；没有密码的账号凭最近登录）
  const reauth = useReauth({ hasPassword: me.has_password, totpEnabled: me.totp_enabled, allowRecentSession: true });
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const add = useMutation({
    mutationFn: (input: Parameters<typeof registerPasskey>[1]) => registerPasskey({ api, webauthn }, input),
    onSuccess: async (created) => {
      toast.success(`已添加通行密钥“${created.name}”`);
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.myPasskeys });
      onClose();
    },
    onError: (error) => {
      if (isApiError(error) && REAUTH_ERRORS.includes(error.code)) reauth.setServerError(error.message);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    const parsedName = trimmed === "" ? null : passkeyNameSchema.safeParse(trimmed);
    setNameError(parsedName?.success === false ? parsedName.error.issues[0]?.message : undefined);
    const body = reauth.collect();
    if (body !== null && parsedName?.success !== false) add.mutate({ reauth: body, name: trimmed });
  };

  const handled = isApiError(add.error) && REAUTH_ERRORS.includes(add.error.code);
  return (
    <form className="dialog-form" onSubmit={submit} noValidate>
      <TextField label="名称（可选）" value={name} error={nameError} maxLength={PASSKEY_NAME_MAX_LENGTH}
        hint="如“MacBook 触控 ID”“YubiKey”，方便以后区分" onChange={(event) => setName(event.target.value)} />
      <ReauthFields controller={reauth} idPrefix="passkey-add" />
      {add.isError && !handled ? <ErrorCallout title="添加失败" {...describeWebAuthnError(add.error)} /> : null}
      <div className="dialog-actions">
        <Button onClick={onClose} disabled={add.isPending}>取消</Button>
        <Button type="submit" variant="primary" busy={add.isPending} busyLabel="等待认证器…">继续并创建</Button>
      </div>
    </form>
  );
}

export function PasskeyAddDialog(props: Props) {
  return (
    <FormDialog open onOpenChange={(open) => !open && props.onClose()} title="添加通行密钥"
      description="确认是你本人后，浏览器会弹出系统窗口，用指纹、面容、设备密码或安全密钥创建通行密钥。">
      <AddForm {...props} />
    </FormDialog>
  );
}
