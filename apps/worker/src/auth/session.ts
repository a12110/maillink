import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  SESSION_COOKIE_NAME,
  SESSION_ID_BYTES,
  SESSION_TOUCH_INTERVAL_SEC,
  SESSION_USER_AGENT_MAX_LENGTH,
} from "../constants";
import { nowSec } from "../clock";
import { deleteSession, findSessionWithUser, insertSession, touchSession } from "../db/sessions";
import { getSettings } from "../db/settings";
import type { SessionWithUser } from "../db/sessions";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import type { AuthContext } from "./context";
import { randomBytes, sha256Hex, toBase64Url } from "./crypto";
import { HTTP_UNAUTHORIZED } from "../http-status";

export type SessionLimits = { idleSec: number; absoluteSec: number };

/** 会话空闲与绝对时长，读系统设置 security.session_*（03 §3）；cron 清理也用它 */
export async function sessionLimits(db: D1Database): Promise<SessionLimits> {
  const settings = await getSettings(db, ["security.session_idle_sec", "security.session_absolute_sec"]);
  return { idleSec: settings["security.session_idle_sec"], absoluteSec: settings["security.session_absolute_sec"] };
}

const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "Lax", path: "/" } as const;

/** 统一的 401：未登录、会话不存在、过期、账号被禁用都用同一个响应，不泄露具体原因 */
export function unauthenticated(): ApiError {
  return new ApiError(HTTP_UNAUTHORIZED, "unauthenticated", "未登录或会话已失效");
}

export function clientIp(c: Context<AppEnv>): string | null {
  return c.req.header("CF-Connecting-IP") ?? null;
}

function clientUserAgent(c: Context<AppEnv>): string | null {
  return c.req.header("User-Agent")?.slice(0, SESSION_USER_AGENT_MAX_LENGTH) ?? null;
}

/**
 * 空闲或绝对超时任一满足即过期。绝对超时同时看建会话时写入的 expires_at 与"创建时间 + 当前设置"：
 * 管理员缩短绝对时长会立即作用于已有会话，延长则只对之后新建的会话生效。
 */
export function sessionExpired(
  session: { created_at: number; last_seen_at: number; expires_at: number },
  now: number,
  limits: SessionLimits,
): boolean {
  return (
    session.expires_at <= now ||
    session.created_at + limits.absoluteSec <= now ||
    session.last_seen_at + limits.idleSec <= now
  );
}

/** 创建会话并下发 Cookie。若请求里带着旧会话 Cookie，先删掉旧会话，避免遗留可用的旧会话 */
export async function startSession(
  c: Context<AppEnv>,
  userId: number,
  authMethods: string[],
): Promise<void> {
  const previous = getCookie(c, SESSION_COOKIE_NAME);
  if (previous) await deleteSession(c.env.APP_DB, await sha256Hex(previous));

  const token = toBase64Url(randomBytes(SESSION_ID_BYTES));
  const now = nowSec();
  const { absoluteSec } = await sessionLimits(c.env.APP_DB);
  await insertSession(c.env.APP_DB, {
    id_hash: await sha256Hex(token),
    user_id: userId,
    auth_methods: authMethods.join(","),
    created_at: now,
    expires_at: now + absoluteSec,
    ip: clientIp(c),
    user_agent: clientUserAgent(c),
  });
  setCookie(c, SESSION_COOKIE_NAME, token, { ...COOKIE_OPTIONS, maxAge: absoluteSec });
}

/** 注销当前请求携带的会话并清 Cookie；没有会话时也不报错（幂等） */
export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (token) await deleteSession(c.env.APP_DB, await sha256Hex(token));
  deleteCookie(c, SESSION_COOKIE_NAME, COOKIE_OPTIONS);
}

function toAuthContext(row: SessionWithUser): AuthContext {
  return {
    user: {
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      email: row.email_lc,
      role: row.role,
      status: "active",
    },
    session: {
      idHash: row.id_hash,
      authMethods: row.auth_methods === "" ? [] : row.auth_methods.split(","),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    },
  };
}

/** 校验请求里的会话 Cookie，返回当前身份；任何不通过的情况都抛统一的 401 */
export async function authenticate(c: Context<AppEnv>): Promise<AuthContext> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) throw unauthenticated();

  const db = c.env.APP_DB;
  const row = await findSessionWithUser(db, await sha256Hex(token));
  if (!row) throw unauthenticated();

  const now = nowSec();
  if (sessionExpired(row, now, await sessionLimits(db))) {
    await deleteSession(db, row.id_hash);
    throw unauthenticated();
  }
  if (row.status !== "active") throw unauthenticated();

  // 节流：last_seen_at 只在距上次写入超过阈值时才更新
  if (now - row.last_seen_at >= SESSION_TOUCH_INTERVAL_SEC) {
    await touchSession(db, row.id_hash, now);
  }
  return toAuthContext(row);
}
