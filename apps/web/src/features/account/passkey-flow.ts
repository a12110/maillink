import type { PasskeyOptionsRequest, PasskeyRegisterVerifyRequest } from "@maillink/shared";
import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";
import type { WebAuthnClient } from "../../lib/webauthn";
import type { ReauthBody } from "./reauth";

export type PasskeyRegisterApi = {
  passkeyRegisterOptions: (body: PasskeyOptionsRequest) => Promise<PublicKeyCredentialCreationOptionsJSON>;
  passkeyRegisterVerify: (body: PasskeyRegisterVerifyRequest) => Promise<{ id: number; name: string }>;
};

/**
 * 添加通行密钥：options（带再确认 `{password}` / `{code}` / `{}`）→ 浏览器创建凭据 → verify `{response, name?}`。
 * 名称留空时不传，由后端生成“通行密钥 N”。
 */
export async function registerPasskey(
  deps: { api: PasskeyRegisterApi; webauthn: WebAuthnClient },
  input: { reauth: ReauthBody; name: string },
): Promise<{ id: number; name: string }> {
  const options = await deps.api.passkeyRegisterOptions(input.reauth);
  const response: RegistrationResponseJSON = await deps.webauthn.register(options);
  const name = input.name.trim();
  return deps.api.passkeyRegisterVerify({ response, ...(name === "" ? {} : { name }) });
}
