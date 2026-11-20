import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { PasskeyLoginVerifyRequest, PasskeyRegisterVerifyRequest } from "@maillink/shared";
import { MS_PER_SEC, PASSKEY_CHALLENGE_BYTES, PASSKEY_CHALLENGE_SEC, PASSKEY_USER_HANDLE_BYTES } from "../constants";
import type { Bindings } from "../env";
import { randomBytes, toBase64Url, utf8 } from "./crypto";
import { KEY_PURPOSES, deriveKey } from "./keys";

// WebAuthn / 通行密钥（03 §4.3）：可发现凭据 + 必须用户验证，不要 attestation。
//
// RP ID 与 origin 只取自 PUBLIC_ORIGIN。凭据在注册时绑定 RP ID（即 PUBLIC_ORIGIN 的主机名）：
// **更换 PUBLIC_ORIGIN 的域名会让所有已注册的通行密钥失效**（浏览器不会再为新域名提供旧凭据，
// 服务端也会因 RP ID / origin 不符拒绝）。这里刻意不做任何兼容或静默迁移，用户需改用密码或 OAuth 登录后重新注册。

export type RelyingParty = { rpID: string; origin: string };

export function relyingParty(env: Pick<Bindings, "PUBLIC_ORIGIN">): RelyingParty {
  const url = new URL(env.PUBLIC_ORIGIN);
  return { rpID: url.hostname, origin: url.origin };
}

/** user handle = HMAC(k_handle, 用户 id) 截断：稳定、不可逆，不把内部 id 或用户名交给认证器 */
export async function passkeyUserHandle(
  env: Pick<Bindings, "APP_SECRET">,
  userId: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const raw = await deriveKey(env, KEY_PURPOSES.passkeyUserHandle);
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(`user:${userId}`)));
  return mac.slice(0, PASSKEY_USER_HANDLE_BYTES);
}

const TIMEOUT_MS = PASSKEY_CHALLENGE_SEC * MS_PER_SEC;

export type RegistrationInput = {
  rp: RelyingParty;
  rpName: string;
  userHandle: Uint8Array<ArrayBuffer>;
  userName: string;
  displayName: string;
  exclude: Array<{ credential_id: string; transports: string[] }>;
};

export function registrationOptions(input: RegistrationInput): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: input.rpName,
    rpID: input.rp.rpID,
    userName: input.userName,
    userID: input.userHandle,
    userDisplayName: input.displayName,
    challenge: randomBytes(PASSKEY_CHALLENGE_BYTES),
    timeout: TIMEOUT_MS,
    attestationType: "none",
    excludeCredentials: input.exclude.map((item) => ({ id: item.credential_id, transports: item.transports })),
    authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
  });
}

export function authenticationOptions(rp: RelyingParty): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: rp.rpID,
    challenge: randomBytes(PASSKEY_CHALLENGE_BYTES),
    timeout: TIMEOUT_MS,
    userVerification: "required",
    allowCredentials: [],
  });
}

/** 校验通过的新凭据 */
export type NewCredential = { credentialId: string; publicKey: string; counter: number; transports: string[] };

/** 校验失败（签名、challenge、origin、RP ID、用户验证任一不符）；原因只写日志 */
export class PasskeyVerificationError extends Error {
  constructor(
    readonly reason: "verification_failed" | "counter_rollback",
    detail: string,
  ) {
    super(detail);
    this.name = "PasskeyVerificationError";
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function verifyRegistration(
  rp: RelyingParty,
  expectedChallenge: string,
  response: PasskeyRegisterVerifyRequest["response"],
): Promise<NewCredential> {
  let result: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    result = await verifyRegistrationResponse({
      response: { ...response, clientExtensionResults: {} },
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch (error) {
    throw new PasskeyVerificationError("verification_failed", describe(error));
  }
  if (!result.verified) throw new PasskeyVerificationError("verification_failed", "registration not verified");
  const { credential } = result.registrationInfo;
  return {
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
  };
}

export type StoredCredential = { credential_id: string; public_key: string; counter: number; transports: string[] };

/** 计数器规则（与 WebAuthn 规范及库一致）：任一方非 0 时，新值必须严格大于库里的值 */
export function counterRolledBack(asserted: number, stored: number): boolean {
  return (asserted > 0 || stored > 0) && asserted <= stored;
}

/**
 * 校验登录断言，返回认证器报告的新计数器值。
 *
 * 计数器检查放在签名校验之后、由本函数自己做：传给库的 counter 固定为 0（库在 counter 为 0 时只跳过
 * 计数器比较，签名、challenge、origin、RP ID、用户验证照常全部校验），通过后再按 counterRolledBack
 * 比较。这样只有"签名有效但计数器回退"（认证器被克隆的信号）才会报 counter_rollback 并写审计，
 * 伪造的断言只会是 verification_failed。库里计数器由调用方用"比较并交换"更新，并发重放也只有一个能通过。
 */
export async function verifyAuthentication(
  rp: RelyingParty,
  expectedChallenge: string,
  response: PasskeyLoginVerifyRequest["response"],
  stored: StoredCredential,
): Promise<number> {
  const credential: WebAuthnCredential = {
    id: stored.credential_id,
    publicKey: isoBase64URL.toBuffer(stored.public_key),
    counter: 0,
    transports: stored.transports,
  };
  let result: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    result = await verifyAuthenticationResponse({
      response: { ...response, clientExtensionResults: {} },
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential,
      requireUserVerification: true,
    });
  } catch (error) {
    throw new PasskeyVerificationError("verification_failed", describe(error));
  }
  if (!result.verified) throw new PasskeyVerificationError("verification_failed", "authentication not verified");
  const asserted = result.authenticationInfo.newCounter;
  if (counterRolledBack(asserted, stored.counter)) {
    throw new PasskeyVerificationError("counter_rollback", `counter ${asserted} <= stored ${stored.counter}`);
  }
  return asserted;
}

export function encodeHandle(handle: Uint8Array): string {
  return toBase64Url(handle);
}
