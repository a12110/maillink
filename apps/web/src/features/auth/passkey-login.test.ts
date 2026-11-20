import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { describe, expect, it, vi } from "vitest";
import type { WebAuthnClient } from "../../lib/webauthn";
import { loginWithPasskey } from "./passkey-login";

const OPTIONS: PublicKeyCredentialRequestOptionsJSON = { challenge: "chal", rpId: "localhost" };
const ASSERTION: AuthenticationResponseJSON = {
  id: "cred",
  rawId: "cred",
  type: "public-key",
  clientExtensionResults: {},
  response: { clientDataJSON: "a", authenticatorData: "b", signature: "c" },
};

function fakes(authenticate: WebAuthnClient["authenticate"]) {
  const order: string[] = [];
  const api = {
    passkeyLoginOptions: vi.fn(async () => (order.push("options"), OPTIONS)),
    passkeyLoginVerify: vi.fn(async () => (order.push("verify"), { status: "ok" })),
  };
  const webauthn: WebAuthnClient = {
    supported: () => true,
    authenticate: vi.fn(async (options) => (order.push("browser"), authenticate(options))),
    register: vi.fn(),
  };
  return { api, webauthn, order };
}

describe("通行密钥登录流程（浏览器 WebAuthn 用替身）", () => {
  it("options → 浏览器 → verify，且把 options 交给浏览器、把断言原样交给 verify", async () => {
    const { api, webauthn, order } = fakes(async () => ASSERTION);
    await loginWithPasskey({ api, webauthn });
    expect(order).toEqual(["options", "browser", "verify"]);
    expect(webauthn.authenticate).toHaveBeenCalledWith(OPTIONS);
    expect(api.passkeyLoginVerify).toHaveBeenCalledWith(ASSERTION);
  });

  it("用户取消系统弹窗：错误抛出，不调用 verify", async () => {
    const { api, webauthn } = fakes(async () => {
      throw new DOMException("cancelled", "NotAllowedError");
    });
    await expect(loginWithPasskey({ api, webauthn })).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(api.passkeyLoginVerify).not.toHaveBeenCalled();
  });
});
