import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes, sha256Hex, toBase64Url, utf8 } from "../auth/crypto";
import { KEY_PURPOSES, deriveKey } from "../auth/keys";
import {
  LINK_VISITOR_COOKIE_MAX_SEC,
  LINK_VISITOR_COOKIE_NAME_CHARS,
  LINK_VISITOR_COOKIE_PATH,
  LINK_VISITOR_COOKIE_PREFIX,
  LINK_VISITOR_ID_BYTES,
} from "../constants";
import { countVisitors, visitorExists } from "../db/link-activity";
import type { ShareLinkRow } from "../db/share-links";
import type { AppEnv } from "../env";
import { denial } from "./guard";
import type { LinkRequest } from "./request";
import { effectiveExpiresAt } from "./view";

// 访客（设备）识别：每个链接一个 Cookie，值是随机串，库里只存 SHA-256（link_visitors.visitor_hash）。
// Cookie 名 = 前缀 + HMAC-SHA256(链接 id) 的前 16 个 base64url 字符：同一链接稳定（rotate token 后设备仍有效），
// 但不暴露自增 id、不可枚举。密钥用独立的 HKDF 用途 link-visitor-cookie（不复用 link-token：那把是 AES-GCM 加密密钥，
// 一把密钥不跨算法使用）。
// Cookie 在 start 登记设备时下发；已登记访客再 start、reveal 时按当前剩余有效期重新下发（续费后不会被旧的 Max-Age 锁在门外）。
// 属性：HttpOnly; Secure; SameSite=Lax; Path=/api/s/，有效期不超过链接剩余有效期。

const VISITOR_VALUE = /^[A-Za-z0-9_-]{43}$/u;

export async function visitorCookieName(env: AppEnv["Bindings"], linkId: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", await deriveKey(env, KEY_PURPOSES.linkVisitorCookie), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(`share-link:${linkId}`)));
  return `${LINK_VISITOR_COOKIE_PREFIX}${toBase64Url(mac).slice(0, LINK_VISITOR_COOKIE_NAME_CHARS)}`;
}

export type VisitorState = { hash: string | null; value: string | null; registered: boolean };

/** 只读：Cookie 的哈希是否已登记为本链接的设备 */
export async function identifyVisitor(c: Context<AppEnv>, linkId: number): Promise<VisitorState> {
  const value = getCookie(c, await visitorCookieName(c.env, linkId));
  if (value === undefined || !VISITOR_VALUE.test(value)) return { hash: null, value: null, registered: false };
  const hash = await sha256Hex(value);
  return { hash, value, registered: await visitorExists(c.env.APP_DB, linkId, hash) };
}

export async function devicesFull(db: D1Database, req: Pick<LinkRequest, "row" | "access">): Promise<boolean> {
  const max = req.access.max_devices;
  return max !== undefined && (await countVisitors(db, req.row.id)) >= max;
}

export type RegisteredVisitor = { hash: string; value: string };

/** 访客 Cookie → 设备数：已登记返回其哈希与原值；未登记时设备已满给 device_limit（带 public_note），否则要求先"开始取码" */
export async function requireVisitor(c: Context<AppEnv>, req: LinkRequest): Promise<RegisteredVisitor> {
  const visitor = await identifyVisitor(c, req.row.id);
  if (visitor.registered && visitor.hash !== null && visitor.value !== null) return { hash: visitor.hash, value: visitor.value };
  if (await devicesFull(c.env.APP_DB, req)) throw denial("device_limit", { public_note: req.row.public_note });
  throw denial("start_required");
}

export function newVisitorValue(): string {
  return toBase64Url(randomBytes(LINK_VISITOR_ID_BYTES));
}

/** 有效期：链接剩余有效期与上限取小（链接已激活时把首次访问后过期也算进去） */
export async function issueVisitorCookie(c: Context<AppEnv>, row: ShareLinkRow, value: string, now: number): Promise<void> {
  const expiresAt = effectiveExpiresAt(row);
  const remaining = expiresAt === null ? LINK_VISITOR_COOKIE_MAX_SEC : Math.min(LINK_VISITOR_COOKIE_MAX_SEC, expiresAt - now);
  setCookie(c, await visitorCookieName(c.env, row.id), value, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: LINK_VISITOR_COOKIE_PATH,
    maxAge: Math.max(1, remaining),
  });
}
