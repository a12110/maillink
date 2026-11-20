import { MS_PER_SECOND } from "../constants";

const EMPTY = "—";
const PAD_WIDTH = 2;

/** 当前时间（Unix 秒），与后端时间戳同单位 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / MS_PER_SECOND);
}

function pad(value: number): string {
  return String(value).padStart(PAD_WIDTH, "0");
}

/** Unix 秒 → 本地时间：今年内 `MM-DD HH:mm`（与原型一致），跨年带年份；null 显示“—” */
export function formatDateTime(unixSec: number | null, now: Date = new Date()): string {
  if (unixSec === null) return EMPTY;
  const d = new Date(unixSec * MS_PER_SECOND);
  const monthDay = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const date = d.getFullYear() === now.getFullYear() ? monthDay : `${d.getFullYear()}-${monthDay}`;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Unix 秒 → 本地完整时间 `YYYY-MM-DD HH:mm:ss`（详情页用） */
export function formatFullDateTime(unixSec: number): string {
  const d = new Date(unixSec * MS_PER_SECOND);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux|X11/, "Linux"],
];

function firstMatch(table: ReadonlyArray<readonly [RegExp, string]>, text: string): string | null {
  return table.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** 把 User-Agent 概括成“Chrome · macOS”；认不出的原样返回，没有则显示“未知设备” */
export function describeUserAgent(userAgent: string | null): string {
  if (userAgent === null || userAgent === "") return "未知设备";
  const parts = [firstMatch(BROWSERS, userAgent), firstMatch(SYSTEMS, userAgent)].filter((p) => p !== null);
  return parts.length > 0 ? parts.join(" · ") : userAgent;
}

/** 用户的展示名：显示名优先，否则用户名 */
export function displayNameOf(user: { username: string; display_name: string | null }): string {
  return user.display_name?.trim() || user.username;
}

export function initialOf(name: string): string {
  return Array.from(name)[0]?.toUpperCase() ?? "?";
}

const AUTH_METHOD_LABEL: Record<string, string> = {
  password: "密码",
  totp: "验证码",
  recovery: "恢复码",
  passkey: "通行密钥",
};
const OAUTH_METHOD_PREFIX = "oauth:";

/** 登录方式标识 → 中文（OAuth 记为 `oauth:<slug>`）；未知值原样显示而不是吞掉 */
export function describeAuthMethod(method: string): string {
  if (method.startsWith(OAUTH_METHOD_PREFIX)) return `第三方（${method.slice(OAUTH_METHOD_PREFIX.length)}）`;
  return AUTH_METHOD_LABEL[method] ?? method;
}
