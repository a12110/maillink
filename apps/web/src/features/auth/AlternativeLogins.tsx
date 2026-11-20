import { useMutation } from "@tanstack/react-query";
import { Fingerprint, LogIn } from "lucide-react";
import { oauthStartPath } from "../../api/endpoints-auth";
import { api } from "../../api/instance";
import { describeWebAuthnError } from "../../lib/webauthn";
import type { WebAuthnClient } from "../../lib/webauthn";
import { Button, ErrorCallout } from "../../ui";
import type { LoginOptions } from "./login-options";
import { loginWithPasskey } from "./passkey-login";

type Props = {
  options: LoginOptions;
  /** 上方有密码表单时才显示“或者”分隔线 */
  divider: boolean;
  webauthn: WebAuthnClient;
  disabled: boolean;
  onSuccess: () => Promise<void>;
};

function PasskeyButton({ webauthn, disabled, onSuccess }: Pick<Props, "webauthn" | "disabled" | "onSuccess">) {
  const login = useMutation({
    mutationFn: async () => {
      await loginWithPasskey({ api, webauthn });
      await onSuccess();
    },
  });
  const supported = webauthn.supported();
  return (
    <>
      <Button block disabled={disabled || !supported} busy={login.isPending} busyLabel="等待通行密钥…"
        title={supported ? undefined : "这个浏览器不支持通行密钥"} onClick={() => login.mutate()}>
        <Fingerprint />
        使用通行密钥登录
      </Button>
      {supported ? null : <p className="field-hint">当前浏览器不支持通行密钥，请换用较新的浏览器，或使用密码登录。</p>}
      {login.isError ? <ErrorCallout title="通行密钥登录失败" {...describeWebAuthnError(login.error)} /> : null}
    </>
  );
}

/** 密码表单下方：按公开配置出现的“通行密钥登录”与各 OAuth 提供方按钮（OAuth 是整页跳转，用链接而不是 fetch） */
export function AlternativeLogins({ options, divider, webauthn, disabled, onSuccess }: Props) {
  const { passkey, providers } = options;
  if (!passkey && providers.length === 0) return null;
  return (
    <div className="auth-alt">
      {divider ? <p className="auth-divider"><span>或者</span></p> : null}
      {passkey ? <PasskeyButton webauthn={webauthn} disabled={disabled} onSuccess={onSuccess} /> : null}
      {providers.map((provider) => (
        <a key={provider.slug} className="btn" data-variant="secondary" data-block="true" href={oauthStartPath(provider.slug, "login")}>
          <LogIn />
          使用 {provider.name} 登录
        </a>
      ))}
    </div>
  );
}
