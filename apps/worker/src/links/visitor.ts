import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes, sha256Hex, toBase64Url } from "../auth/crypto";
import {
  LINK_VISITOR_COOKIE_MAX_SEC,
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

// 访客（设备）识别：每个链接一个 Cookie（名字带链接 id），值是随机串，库里只存 SHA-256（link_visitors.visitor_hash）。
// Cookie 只在 POST /start 成功登记设备时下发：HttpOnly; Secure; SameSite=Lax; Path=/api/s/，有效期不超过链接剩余有效期。

const VISITOR_VALUE = /^[A-Za-z0-9_-]{43}$/u;

export function visitorCookieName(linkId: number): string {
  return `${LINK_VISITOR_COOKIE_PREFIX}${linkId}`;
}

export type VisitorState = { hash: string | null; registered: boolean };

/** 只读：Cookie 的哈希是否已登记为本链接的设备 */
export async function identifyVisitor(c: Context<AppEnv>, linkId: number): Promise<VisitorState> {
  const value = getCookie(c, visitorCookieName(linkId));
  if (value === undefined || !VISITOR_VALUE.test(value)) return { hash: null, registered: false };
  const hash = await sha256Hex(value);
  return { hash, registered: await visitorExists(c.env.APP_DB, linkId, hash) };
}

export async function devicesFull(db: D1Database, req: Pick<LinkRequest, "row" | "access">): Promise<boolean> {
  const max = req.access.max_devices;
  return max !== undefined && (await countVisitors(db, req.row.id)) >= max;
}

/** 访客 Cookie → 设备数：已登记返回其哈希；未登记时设备已满给 device_limit（带 public_note），否则要求先"开始取码" */
export async function requireVisitor(c: Context<AppEnv>, req: LinkRequest): Promise<string> {
  const visitor = await identifyVisitor(c, req.row.id);
  if (visitor.registered && visitor.hash !== null) return visitor.hash;
  if (await devicesFull(c.env.APP_DB, req)) throw denial("device_limit", { public_note: req.row.public_note });
  throw denial("start_required");
}

export function newVisitorValue(): string {
  return toBase64Url(randomBytes(LINK_VISITOR_ID_BYTES));
}

/** 有效期：链接剩余有效期与上限取小（链接已激活时把首次访问后过期也算进去） */
export function issueVisitorCookie(c: Context<AppEnv>, row: ShareLinkRow, value: string, now: number): void {
  const expiresAt = effectiveExpiresAt(row);
  const remaining = expiresAt === null ? LINK_VISITOR_COOKIE_MAX_SEC : Math.min(LINK_VISITOR_COOKIE_MAX_SEC, expiresAt - now);
  setCookie(c, visitorCookieName(row.id), value, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: LINK_VISITOR_COOKIE_PATH,
    maxAge: Math.max(1, remaining),
  });
}
