// RFC 6238 TOTP（SHA-1、6 位、30 秒一步），与服务端 auth/totp.ts 的参数一致；只用 node:crypto。
import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BITS_PER_BASE32_CHAR = 5;
const BITS_PER_BYTE = 8;
export const TOTP_PERIOD_SEC = 30;
const TOTP_DIGITS = 6;
const COUNTER_BYTES = 8;
const LOW_NIBBLE = 0x0f;
const MASK_31_BITS = 0x7fffffff;
const MS_PER_SECOND = 1000;

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`密钥含有非 base32 字符：${char}`);
    value = (value << BITS_PER_BASE32_CHAR) | index;
    bits += BITS_PER_BASE32_CHAR;
    if (bits >= BITS_PER_BYTE) {
      bits -= BITS_PER_BYTE;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** 当前的时间步序号 */
export function currentTotpStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / MS_PER_SECOND / TOTP_PERIOD_SEC);
}

/** 指定时间步的验证码。服务端容忍前后各一步，且同一步只能用一次（防重放） */
export function totpAtStep(secret: string, step: number): string {
  const counter = Buffer.alloc(COUNTER_BYTES);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & LOW_NIBBLE;
  const binary = digest.readUInt32BE(offset) & MASK_31_BITS;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}
