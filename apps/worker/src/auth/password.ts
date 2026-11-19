import {
  BITS_PER_BYTE,
  PASSWORD_HASH_ALGORITHM,
  PASSWORD_SALT_BYTES,
  PBKDF2_HASH_BYTES,
  PBKDF2_ITERATIONS,
} from "../constants";
import type { Bindings } from "../env";
import { fromBase64, randomBytes, timingSafeEqualBytes, toBase64, utf8 } from "./crypto";
import { KEY_PURPOSES, deriveKey } from "./keys";

// 存储格式：pbkdf2-sha256$<迭代数>$<盐 base64>$<哈希 base64>
// 实际参与 PBKDF2 的口令是 HMAC-SHA256(pepper, 密码)：pepper 来自 APP_SECRET，库泄露但密钥未泄露时无法离线爆破。

type PasswordEnv = Pick<Bindings, "APP_SECRET">;
type ParsedHash = { iterations: number; salt: Uint8Array; hash: Uint8Array };

const HASH_FIELD_COUNT = 4;

async function derivePasswordBits(
  env: PasswordEnv,
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const pepper = await deriveKey(env, KEY_PURPOSES.passwordPepper);
  const hmacKey = await crypto.subtle.importKey("raw", pepper, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const peppered = await crypto.subtle.sign("HMAC", hmacKey, utf8(password));
  const baseKey = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    baseKey,
    PBKDF2_HASH_BYTES * BITS_PER_BYTE,
  );
  return new Uint8Array(bits);
}

function formatHash(iterations: number, salt: Uint8Array, hash: Uint8Array): string {
  return [PASSWORD_HASH_ALGORITHM, iterations, toBase64(salt), toBase64(hash)].join("$");
}

/** 格式不对属于数据损坏，直接抛错暴露，不当作"密码错误"悄悄吞掉 */
export function parsePasswordHash(stored: string): ParsedHash {
  const parts = stored.split("$");
  const [algorithm, iterationText, saltText, hashText] = parts;
  if (parts.length !== HASH_FIELD_COUNT || algorithm !== PASSWORD_HASH_ALGORITHM) {
    throw new Error("password_hash 格式无法识别");
  }
  const iterations = Number(iterationText);
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error("password_hash 的迭代数无效");
  }
  const salt = fromBase64(saltText ?? "");
  const hash = fromBase64(hashText ?? "");
  if (salt.byteLength !== PASSWORD_SALT_BYTES || hash.byteLength !== PBKDF2_HASH_BYTES) {
    throw new Error("password_hash 数据损坏：盐或哈希的长度不符");
  }
  return { iterations, salt, hash };
}

export async function hashPassword(
  env: PasswordEnv,
  password: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  return formatHash(iterations, salt, await derivePasswordBits(env, password, salt, iterations));
}

/** 按存储里的迭代数计算并常量时间比较 */
export async function verifyPassword(env: PasswordEnv, password: string, stored: string): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  const actual = await derivePasswordBits(env, password, parsed.salt, parsed.iterations);
  return timingSafeEqualBytes(actual, parsed.hash);
}

/** 用户不存在 / 未设密码时做一次等量计算，避免从响应耗时推断用户名是否存在。始终返回 false */
export async function burnPasswordCheck(env: PasswordEnv, password: string): Promise<false> {
  const salt = new Uint8Array(PASSWORD_SALT_BYTES);
  await derivePasswordBits(env, password, salt, PBKDF2_ITERATIONS);
  return false;
}
