import { TOTP_DIGITS, TOTP_PERIOD_SEC, TOTP_WINDOW_STEPS } from "../constants";
import { timingSafeEqualBytes, utf8 } from "./crypto";

// RFC 6238 TOTP（HMAC-SHA1、6 位、30 秒）与 RFC 4648 base32。纯函数，时间由调用方传入。

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE32_BITS = 5;
const BYTE_BITS = 8;
const BYTE_MASK = 0xff;
const BASE32_MASK = 0x1f;
const COUNTER_BYTES = 8;
const UINT32_RANGE = 0x1_0000_0000;
const DYNAMIC_OFFSET_MASK = 0x0f;
/** 动态截断：去掉最高位，得到 31 位无符号整数 */
const HOTP_TRUNCATE_MASK = 0x7fffffff;
const DECIMAL_BASE = 10;

export function base32Encode(bytes: Uint8Array): string {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << BYTE_BITS) | byte;
    bits += BYTE_BITS;
    while (bits >= BASE32_BITS) {
      bits -= BASE32_BITS;
      output += BASE32_ALPHABET[(buffer >> bits) & BASE32_MASK];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (BASE32_BITS - bits)) & BASE32_MASK];
  return output;
}

/** 解码 base32（忽略大小写、空格与末尾 `=`）；含非法字符时抛 Error */
export function base32Decode(text: string): Uint8Array {
  const clean = text.replace(/[\s=]/g, "").toUpperCase();
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) throw new Error("无效的 base32 字符");
    buffer = (buffer << BASE32_BITS) | value;
    bits += BASE32_BITS;
    if (bits >= BYTE_BITS) {
      bits -= BYTE_BITS;
      output.push((buffer >> bits) & BYTE_MASK);
    }
    buffer &= (1 << bits) - 1;
  }
  return Uint8Array.from(output);
}

function counterBytes(step: number): Uint8Array {
  const bytes = new Uint8Array(COUNTER_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, Math.floor(step / UINT32_RANGE));
  view.setUint32(COUNTER_BYTES / 2, step % UINT32_RANGE);
  return bytes;
}

/** RFC 4226 HOTP：动态截断后取低 6 位十进制 */
export async function hotp(secret: Uint8Array, step: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes(step)));
  const offset = (digest[digest.length - 1] ?? 0) & DYNAMIC_OFFSET_MASK;
  const view = new DataView(digest.buffer);
  const binary = view.getUint32(offset) & HOTP_TRUNCATE_MASK;
  return String(binary % DECIMAL_BASE ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function totpStep(nowSec: number): number {
  return Math.floor(nowSec / TOTP_PERIOD_SEC);
}

export function totpAt(secret: Uint8Array, nowSec: number): Promise<string> {
  return hotp(secret, totpStep(nowSec));
}

const CODE_PATTERN = new RegExp(`^\\d{${TOTP_DIGITS}}$`);

/**
 * 在 [当前步 - 1, 当前步 + 1] 内校验验证码，返回匹配的时间步；不匹配返回 null。
 * 防重放（同一时间步只能用一次）由调用方用返回的时间步与库里的 totp_last_step 比较完成。
 */
export async function matchTotp(secret: Uint8Array, code: string, nowSec: number): Promise<number | null> {
  if (!CODE_PATTERN.test(code)) return null;
  const current = totpStep(nowSec);
  let matched: number | null = null;
  // 三个时间步都算完再返回，耗时不随匹配位置变化
  for (let offset = -TOTP_WINDOW_STEPS; offset <= TOTP_WINDOW_STEPS; offset += 1) {
    const step = current + offset;
    if (timingSafeEqualBytes(utf8(await hotp(secret, step)), utf8(code)) && matched === null) matched = step;
  }
  return matched;
}

export function otpauthUri(issuer: string, account: string, secretBase32: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
