import { useMutation } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { totpCodeSchema } from "@maillink/shared";
import type { MeResponse, TotpSetupResponse } from "@maillink/shared";
import { isApiError } from "../../api/errors";
import { api } from "../../api/instance";
import { describeAuthError } from "../../lib/auth-messages";
import { Button, Callout, ErrorCallout, TextField } from "../../ui";
import { useCopy } from "../mail/useCopy";
import { QrCode } from "./QrCode";
import { ReauthFields, useReauth } from "./ReauthFields";

type Props = {
  me: MeResponse;
  setup: Pick<TotpSetupResponse, "secret" | "otpauth_uri">;
  onEnabled: (codes: string[]) => void;
  onCancel: () => void;
};

const REAUTH_FIELD_ERRORS = ["reauth_failed", "reauth_required"];

/** 启用 2FA 的第二步：扫码（或手输密钥）→ 输入验证器上的一次验证码 → 提交（有密码的账号还要当前密码） */
export function TotpSetupPanel({ me, setup, onEnabled, onCancel }: Props) {
  const { copy, error: copyError } = useCopy();
  const reauth = useReauth({ hasPassword: me.has_password, totpEnabled: false, allowRecentSession: true });
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | undefined>();
  const enable = useMutation({
    mutationFn: api.totpEnable,
    // 响应里有明文恢复码：不要留在 mutation 缓存里（默认 5 分钟），用完即丢
    gcTime: 0,
    onSuccess: ({ recovery_codes }) => onEnabled(recovery_codes),
    onError: (error) => {
      if (isApiError(error) && REAUTH_FIELD_ERRORS.includes(error.code)) reauth.setServerError(error.message);
      if (isApiError(error, "invalid_totp_code")) setCodeError(error.message);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsedCode = totpCodeSchema.safeParse(code);
    setCodeError(parsedCode.success ? undefined : parsedCode.error.issues[0]?.message);
    const body = reauth.collect();
    if (parsedCode.success && body !== null) enable.mutate({ code: parsedCode.data, ...body });
  };

  const expired = isApiError(enable.error, "totp_setup_expired");
  const handled = isApiError(enable.error) && [...REAUTH_FIELD_ERRORS, "invalid_totp_code", "totp_setup_expired"].includes(enable.error.code);
  return (
    <div className="setup-grid">
      <QrCode value={setup.otpauth_uri} label="两步验证二维码，用验证器应用扫描" />
      <form className="setup-steps" onSubmit={submit} noValidate>
        <ol>
          <li>用验证器应用（如 1Password、Google Authenticator、Authy）扫描左侧二维码。</li>
          <li>无法扫码时，改为手动输入下面的密钥。</li>
          <li>输入应用里显示的 6 位验证码，确认配置正确。</li>
        </ol>
        <div className="secret-box">
          <code aria-label="手动输入的密钥">{setup.secret}</code>
          <Button size="sm" onClick={() => void copy(setup.secret, "密钥已复制")}><Copy />复制</Button>
        </div>
        {copyError ? <p className="field-error">复制失败：{copyError}。请手动选中密钥。</p> : null}
        <TextField label="验证码" mono inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} error={codeError}
          onChange={(event) => setCode(event.target.value)} />
        <ReauthFields controller={reauth} idPrefix="totp-enable" />
        {expired ? <Callout tone="warning" title="设置已过期">二维码有效期很短。请点“取消”，再重新开始启用。</Callout> : null}
        {enable.isError && !handled ? <ErrorCallout title="启用失败" {...describeAuthError(enable.error)} /> : null}
        <div className="form-actions">
          <Button type="submit" variant="primary" busy={enable.isPending} busyLabel="启用中…" disabled={expired}>启用两步验证</Button>
          <Button onClick={onCancel} disabled={enable.isPending}>取消</Button>
        </div>
      </form>
    </div>
  );
}
