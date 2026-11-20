import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { describeAuthError } from "./auth-messages";

/**
 * 浏览器 WebAuthn 的窄接口。组件与流程函数只依赖它，测试注入替身，产品代码里没有任何测试分支。
 */
export type WebAuthnClient = {
  supported: () => boolean;
  authenticate: (options: PublicKeyCredentialRequestOptionsJSON) => Promise<AuthenticationResponseJSON>;
  register: (options: PublicKeyCredentialCreationOptionsJSON) => Promise<RegistrationResponseJSON>;
};

export const browserWebAuthn: WebAuthnClient = {
  supported: browserSupportsWebAuthn,
  authenticate: (optionsJSON) => startAuthentication({ optionsJSON }),
  register: (optionsJSON) => startRegistration({ optionsJSON }),
};

/** 用户在系统弹窗里取消 / 超时，浏览器统一抛 NotAllowedError，库把它包成 WebAuthnError 或原样抛出 */
function isCancelled(error: unknown): boolean {
  if (error instanceof WebAuthnError) return error.cause instanceof Error && error.cause.name === "NotAllowedError";
  return error instanceof Error && error.name === "NotAllowedError";
}

/** 浏览器 / 认证器层面的失败与后端错误分开说明；其余错误交给通用文案 */
export function describeWebAuthnError(error: unknown): { message: string; detail: string } {
  if (isCancelled(error)) {
    return { message: "已取消，或等待认证器操作超时。可以再试一次。", detail: "NotAllowedError" };
  }
  if (error instanceof WebAuthnError) {
    return { message: error.message, detail: error.code };
  }
  return describeAuthError(error);
}
