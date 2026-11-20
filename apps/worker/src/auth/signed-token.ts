import type { z } from "zod";
import type { Bindings } from "../env";
import { fromBase64Url, timingSafeEqualBytes, toBase64Url, utf8 } from "./crypto";
import { KEY_PURPOSES, deriveKey } from "./keys";
import type { KeyPurpose } from "./keys";
import { SecretBoxError, openText, sealText } from "./secret-box";

// 短时流程令牌（放在 Cookie 里，不落库）。两种封装：
// - 签名：`<base64url(JSON)>.<base64url(HMAC-SHA256(k_sign, typ + "." + base64url(JSON)))>`，
//   内容客户端可读但不可改。用于 pending_auth、通行密钥 challenge（里面没有秘密）。
// - 加密：secret-box 的 AES-GCM 密文，AAD = `cookie:<typ>`。用于 TOTP 暂存密钥、OAuth 流程状态
//   （含 PKCE code_verifier 与 nonce，不能让客户端或日志看到明文）。
// 两种载荷都必须带 `typ`、`exp`（Unix 秒）、`jti`（随机 id，用于一次性消费，见 db/flow-tokens.ts）。

export type FlowTokenBase = { typ: string; exp: number; jti: string };

/** 令牌无效：格式、签名、类型、过期任一不通过。对外统一处理，不区分具体原因 */
export class FlowTokenError extends Error {
  constructor(readonly reason: "malformed" | "bad_signature" | "wrong_type" | "expired") {
    super(`流程令牌无效：${reason}`);
    this.name = "FlowTokenError";
  }
}

const SIGNED_PART_COUNT = 2;

async function hmacKey(env: Pick<Bindings, "APP_SECRET">): Promise<CryptoKey> {
  const raw = await deriveKey(env, KEY_PURPOSES.signedCookie);
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function mac(env: Pick<Bindings, "APP_SECRET">, typ: string, body: string): Promise<Uint8Array> {
  const key = await hmacKey(env);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(`${typ}.${body}`)));
}

function decodeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FlowTokenError("malformed");
  }
}

/** 解析后的载荷再按 schema 校验，并检查类型与过期 */
function checkPayload<S extends z.ZodType<FlowTokenBase>>(
  schema: S,
  raw: unknown,
  typ: string,
  now: number,
): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new FlowTokenError("malformed");
  if (parsed.data.typ !== typ) throw new FlowTokenError("wrong_type");
  if (parsed.data.exp <= now) throw new FlowTokenError("expired");
  return parsed.data;
}

export async function signToken<T extends FlowTokenBase>(env: Pick<Bindings, "APP_SECRET">, payload: T): Promise<string> {
  const body = toBase64Url(utf8(JSON.stringify(payload)));
  return `${body}.${toBase64Url(await mac(env, payload.typ, body))}`;
}

export async function verifySignedToken<S extends z.ZodType<FlowTokenBase>>(
  env: Pick<Bindings, "APP_SECRET">,
  token: string,
  typ: string,
  schema: S,
  now: number,
): Promise<z.output<S>> {
  const parts = token.split(".");
  const [body, signature] = parts;
  if (parts.length !== SIGNED_PART_COUNT || !body || !signature) throw new FlowTokenError("malformed");
  let given: Uint8Array;
  let json: string;
  try {
    given = fromBase64Url(signature);
    json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(fromBase64Url(body));
  } catch {
    throw new FlowTokenError("malformed");
  }
  // 先验签再解析：未通过签名的内容一律不解释
  if (!timingSafeEqualBytes(given, await mac(env, typ, body))) throw new FlowTokenError("bad_signature");
  return checkPayload(schema, decodeJson(json), typ, now);
}

const ENCRYPTED_PURPOSE: KeyPurpose = KEY_PURPOSES.encryptedCookie;

export function encryptToken<T extends FlowTokenBase>(env: Pick<Bindings, "APP_SECRET">, payload: T): Promise<string> {
  return sealText(env, ENCRYPTED_PURPOSE, `cookie:${payload.typ}`, JSON.stringify(payload));
}

export async function decryptToken<S extends z.ZodType<FlowTokenBase>>(
  env: Pick<Bindings, "APP_SECRET">,
  token: string,
  typ: string,
  schema: S,
  now: number,
): Promise<z.output<S>> {
  let json: string;
  try {
    json = await openText(env, ENCRYPTED_PURPOSE, `cookie:${typ}`, token);
  } catch (error) {
    if (error instanceof SecretBoxError) throw new FlowTokenError("bad_signature");
    throw error;
  }
  return checkPayload(schema, decodeJson(json), typ, now);
}
