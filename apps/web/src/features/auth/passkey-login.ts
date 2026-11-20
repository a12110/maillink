import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import type { WebAuthnClient } from "../../lib/webauthn";

export type PasskeyLoginApi = {
  passkeyLoginOptions: () => Promise<PublicKeyCredentialRequestOptionsJSON>;
  passkeyLoginVerify: (response: AuthenticationResponseJSON) => Promise<unknown>;
};

/** 通行密钥登录：options（后端写 challenge Cookie）→ 浏览器认证器 → verify `{response}`，成功后会话 Cookie 已发出 */
export async function loginWithPasskey(deps: { api: PasskeyLoginApi; webauthn: WebAuthnClient }): Promise<void> {
  const options = await deps.api.passkeyLoginOptions();
  const response = await deps.webauthn.authenticate(options);
  await deps.api.passkeyLoginVerify(response);
}
