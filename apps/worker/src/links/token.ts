import { LINK_PUBLIC_PATH_PREFIX, LINK_TOKEN_BYTES, LINK_TOKEN_HINT_LENGTH, LINK_TOKEN_IV_BYTES } from "../constants";
import { fromBase64, randomBytes, sha256Hex, toBase64Url, utf8 } from "../auth/crypto";
import { KEY_PURPOSES, deriveKey } from "../auth/keys";
import type { Bindings } from "../env";

// 取件链接 token（02 §6）：32 字节随机数的 base64url。库里存三样：
//   - token_hash：SHA-256 hex，公开接口只按它查（不按前缀、不按 hint）；
//   - token_enc：AES-256-GCM 密文，管理员"取回完整链接"与导出时解密。密钥用 HKDF 从 APP_SECRET 派生（用途 link-token）。
//     AAD 绑定本行的 token_hash：建链接时还没有 id（批量创建在一个 batch 里插入），而 token_hash 已知且唯一；
//     解密后再核对 SHA-256(明文) == token_hash，密文被挪到别的行或被篡改都会失败；
//   - token_hint：前 6 位，列表里辨认用。

type TokenEnv = Pick<Bindings, "APP_SECRET">;

export type NewLinkToken = { token: string; token_hash: string; token_enc: string; token_hint: string };

const FORMAT_VERSION = "v1";
const AAD_PREFIX = "maillink/link-token/v1:";
const BASE64_BITS_PER_CHAR = 6;
const BITS_PER_BYTE = 8;
const TOKEN_LENGTH = Math.ceil((LINK_TOKEN_BYTES * BITS_PER_BYTE) / BASE64_BITS_PER_CHAR);
const TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${TOKEN_LENGTH}}$`, "u");
const BASE64_BLOCK = 4;

/** 路径里的 token 格式是否可能合法；不合法直接当不存在，不去查库 */
export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function hashLinkToken(token: string): Promise<string> {
  return sha256Hex(token);
}

function fromBase64Url(text: string): Uint8Array {
  const standard = text.replaceAll("-", "+").replaceAll("_", "/");
  return fromBase64(standard.padEnd(Math.ceil(standard.length / BASE64_BLOCK) * BASE64_BLOCK, "="));
}

/** 每个请求派生一次 AES-GCM 密钥，批量创建 / 导出时复用（不要每个 token 跑一次 HKDF） */
export async function linkTokenKey(env: TokenEnv): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", await deriveKey(env, KEY_PURPOSES.linkToken), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptToken(key: CryptoKey, token: string, tokenHash: string): Promise<string> {
  const iv = randomBytes(LINK_TOKEN_IV_BYTES);
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8(`${AAD_PREFIX}${tokenHash}`) }, key, utf8(token));
  return [FORMAT_VERSION, toBase64Url(iv), toBase64Url(new Uint8Array(sealed))].join(".");
}

/** 解密并核对哈希；格式、密钥或数据任何一处不对都抛错（数据损坏或密钥被换，不能静默返回） */
export async function decryptLinkToken(key: CryptoKey, tokenEnc: string, tokenHash: string): Promise<string> {
  const [version, ivText, sealedText, ...rest] = tokenEnc.split(".");
  if (version !== FORMAT_VERSION || ivText === undefined || sealedText === undefined || rest.length > 0) {
    throw new Error("token_enc 格式无法识别");
  }
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(ivText), additionalData: utf8(`${AAD_PREFIX}${tokenHash}`) },
    key,
    fromBase64Url(sealedText),
  );
  const token = new TextDecoder().decode(plain);
  if ((await hashLinkToken(token)) !== tokenHash) throw new Error("token_enc 与 token_hash 不一致");
  return token;
}

export async function createLinkToken(key: CryptoKey): Promise<NewLinkToken> {
  const token = toBase64Url(randomBytes(LINK_TOKEN_BYTES));
  const tokenHash = await hashLinkToken(token);
  return {
    token,
    token_hash: tokenHash,
    token_enc: await encryptToken(key, token, tokenHash),
    token_hint: token.slice(0, LINK_TOKEN_HINT_LENGTH),
  };
}

export function linkUrl(env: Pick<Bindings, "PUBLIC_ORIGIN">, token: string): string {
  return new URL(`${LINK_PUBLIC_PATH_PREFIX}${token}`, env.PUBLIC_ORIGIN).toString();
}
