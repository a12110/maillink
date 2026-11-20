import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";
import { describe, expect, it, vi } from "vitest";
import type { WebAuthnClient } from "../../lib/webauthn";
import { registerPasskey } from "./passkey-flow";

const OPTIONS: PublicKeyCredentialCreationOptionsJSON = {
  challenge: "chal",
  rp: { name: "MailLink", id: "localhost" },
  user: { id: "u", name: "alice", displayName: "alice" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
};
const CREDENTIAL: RegistrationResponseJSON = {
  id: "cred",
  rawId: "cred",
  type: "public-key",
  clientExtensionResults: {},
  response: { clientDataJSON: "a", attestationObject: "b" },
};

function fakes() {
  const api = {
    passkeyRegisterOptions: vi.fn(async () => OPTIONS),
    passkeyRegisterVerify: vi.fn(async () => ({ id: 1, name: "x" })),
  };
  const webauthn: WebAuthnClient = { supported: () => true, authenticate: vi.fn(), register: vi.fn(async () => CREDENTIAL) };
  return { api, webauthn };
}

describe("添加通行密钥：options 的再确认请求体三种形态", () => {
  it.each([
    ["{password}", { password: "pw" }],
    ["{code}", { code: "123456" }],
    ["{}", {}],
  ])("%s 原样交给 options，再确认之后才调用浏览器", async (_label, reauth) => {
    const deps = fakes();
    await registerPasskey(deps, { reauth, name: "" });
    expect(deps.api.passkeyRegisterOptions).toHaveBeenCalledWith(reauth);
    expect(deps.webauthn.register).toHaveBeenCalledWith(OPTIONS);
  });

  it("名称：留空时 verify 不带 name；有名称时 trim 后带上", async () => {
    const empty = fakes();
    await registerPasskey(empty, { reauth: {}, name: "   " });
    expect(empty.api.passkeyRegisterVerify).toHaveBeenCalledWith({ response: CREDENTIAL });

    const named = fakes();
    await registerPasskey(named, { reauth: { password: "pw" }, name: " MacBook " });
    expect(named.api.passkeyRegisterVerify).toHaveBeenCalledWith({ response: CREDENTIAL, name: "MacBook" });
  });

  it("再确认失败（options 抛错）→ 不调用浏览器；用户取消 → 不调用 verify", async () => {
    const failing = fakes();
    failing.api.passkeyRegisterOptions.mockRejectedValueOnce(new Error("reauth_failed"));
    await expect(registerPasskey(failing, { reauth: { password: "bad" }, name: "" })).rejects.toThrow("reauth_failed");
    expect(failing.webauthn.register).not.toHaveBeenCalled();

    const cancelled = fakes();
    vi.mocked(cancelled.webauthn.register).mockRejectedValueOnce(new DOMException("x", "NotAllowedError"));
    await expect(registerPasskey(cancelled, { reauth: {}, name: "" })).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(cancelled.api.passkeyRegisterVerify).not.toHaveBeenCalled();
  });
});
