import { RECOVERY_CODE_COUNT, RECOVERY_CODE_LENGTH } from "../constants";
import type { Bindings } from "../env";
import { randomBytes, toHex, utf8 } from "./crypto";
import { KEY_PURPOSES, deriveKey } from "./keys";

// 恢复码：10 个，每个 10 个字符（Crockford 风格字母表，去掉易混的 I L O U），展示为 `xxxxx-xxxxx`。
// 每个 50 位熵，库里只存 HMAC-SHA256(k_recovery, 规范化后的码)：高熵随机串不需要慢哈希，
// 加了 APP_SECRET 派生的密钥后，仅凭库内容无法离线验证候选码。

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ALPHABET_MASK = 0x1f;
const GROUP_SIZE = 5;

function randomCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  // 字母表正好 32 个字符，取每个字节低 5 位不会引入偏差
  const chars = Array.from(bytes, (byte) => ALPHABET[byte & ALPHABET_MASK] ?? "");
  return `${chars.slice(0, GROUP_SIZE).join("")}-${chars.slice(GROUP_SIZE).join("")}`;
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, randomCode);
}

/** 去掉空白与连字符并转大写；规范化后长度或字符不对返回 null */
export function normalizeRecoveryCode(input: string): string | null {
  const normalized = input.replace(/[\s-]/g, "").toUpperCase();
  if (normalized.length !== RECOVERY_CODE_LENGTH) return null;
  for (const char of normalized) if (!ALPHABET.includes(char)) return null;
  return normalized;
}

/** 返回把规范化恢复码映射为库内摘要的函数（同一请求内复用派生出的密钥） */
export async function createRecoveryCodeHasher(
  env: Pick<Bindings, "APP_SECRET">,
): Promise<(normalized: string) => Promise<string>> {
  const raw = await deriveKey(env, KEY_PURPOSES.recoveryCode);
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return async (normalized) => toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(normalized))));
}
