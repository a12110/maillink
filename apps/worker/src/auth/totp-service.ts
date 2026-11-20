import { claimTotpStep, findTotpState } from "../db/totp";
import type { Bindings } from "../env";
import { KEY_PURPOSES } from "./keys";
import { openText, sealText } from "./secret-box";
import { base32Decode, matchTotp } from "./totp";

// TOTP 的业务封装：密钥加解密（AAD 绑定用户 id）与"校验 + 占用时间步"。

function totpAad(userId: number): string {
  return `totp:${userId}`;
}

export function encryptTotpSecret(
  env: Pick<Bindings, "APP_SECRET">,
  userId: number,
  secretBase32: string,
): Promise<string> {
  return sealText(env, KEY_PURPOSES.totpSecret, totpAad(userId), secretBase32);
}

/** 解密失败说明数据损坏或 APP_SECRET 被换过，直接抛出（500），不当作"验证码错误" */
export async function decryptTotpSecret(
  env: Pick<Bindings, "APP_SECRET">,
  userId: number,
  secretEnc: string,
): Promise<Uint8Array> {
  return base32Decode(await openText(env, KEY_PURPOSES.totpSecret, totpAad(userId), secretEnc));
}

export type TotpCheck = "ok" | "invalid" | "replayed" | "not_enabled";

/** 校验用户当前的 TOTP；通过时占用该时间步，同一时间步的码第二次提交返回 replayed */
export async function verifyUserTotp(
  env: Pick<Bindings, "APP_SECRET" | "APP_DB">,
  userId: number,
  code: string,
  now: number,
): Promise<TotpCheck> {
  const state = await findTotpState(env.APP_DB, userId);
  if (!state?.totp_secret_enc) return "not_enabled";
  const secret = await decryptTotpSecret(env, userId, state.totp_secret_enc);
  const step = await matchTotp(secret, code, now);
  if (step === null) return "invalid";
  return (await claimTotpStep(env.APP_DB, userId, step)) ? "ok" : "replayed";
}
