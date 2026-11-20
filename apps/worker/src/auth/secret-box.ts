import type { Bindings } from "../env";
import { fromBase64Url, randomBytes, toBase64Url, utf8 } from "./crypto";
import type { KeyPurpose } from "./keys";
import { deriveKey } from "./keys";

// AES-256-GCM 加解密。密文格式：`v1.<base64url(12 字节 IV)>.<base64url(密文 + 16 字节 tag)>`。
// 每次加密随机 IV；AAD（附加认证数据）把密文绑定到用途与上下文（如 `totp:<用户 id>`），
// 把一行的密文挪到另一行、或把一种 Cookie 当另一种用，解密都会失败。

const FORMAT_VERSION = "v1";
const IV_BYTES = 12;
const PART_COUNT = 3;

/** 解密失败（被篡改、密钥不符、格式错误）。调用方决定是 401 还是数据损坏 */
export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

async function importAesKey(env: Pick<Bindings, "APP_SECRET">, purpose: KeyPurpose): Promise<CryptoKey> {
  const raw = await deriveKey(env, purpose);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealText(
  env: Pick<Bindings, "APP_SECRET">,
  purpose: KeyPurpose,
  aad: string,
  plaintext: string,
): Promise<string> {
  const key = await importAesKey(env, purpose);
  const iv = randomBytes(IV_BYTES);
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8(aad) }, key, utf8(plaintext));
  return [FORMAT_VERSION, toBase64Url(iv), toBase64Url(new Uint8Array(sealed))].join(".");
}

export async function openText(
  env: Pick<Bindings, "APP_SECRET">,
  purpose: KeyPurpose,
  aad: string,
  sealed: string,
): Promise<string> {
  const parts = sealed.split(".");
  const [version, ivText, dataText] = parts;
  if (parts.length !== PART_COUNT || version !== FORMAT_VERSION || !ivText || !dataText) {
    throw new SecretBoxError("密文格式无法识别");
  }
  let iv: Uint8Array;
  let data: Uint8Array;
  try {
    iv = fromBase64Url(ivText);
    data = fromBase64Url(dataText);
  } catch {
    throw new SecretBoxError("密文编码无效");
  }
  if (iv.byteLength !== IV_BYTES) throw new SecretBoxError("IV 长度不符");
  const key = await importAesKey(env, purpose);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: utf8(aad) }, key, data);
    return new TextDecoder().decode(plain);
  } catch {
    throw new SecretBoxError("解密失败：密文被篡改或密钥不符");
  }
}
