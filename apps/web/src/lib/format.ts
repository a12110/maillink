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

/**
 * 窄列用：今年内 `MM-DD HH:mm`，跨年只显示日期 `YYYY-MM-DD`（带年份的完整时间约 149px，放不进 112–120px 的列）；
 * title 始终是完整时间 `YYYY-MM-DD HH:mm:ss`。
 */
export function formatCompactDateTime(unixSec: number, now: Date = new Date()): { text: string; title: string } {
  const d = new Date(unixSec * MS_PER_SECOND);
  const title = formatFullDateTime(unixSec);
  if (d.getFullYear() === now.getFullYear()) return { text: formatDateTime(unixSec, now), title };
  return { text: title.slice(0, "YYYY-MM-DD".length), title };
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

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** Unix 秒 → “32 秒前 / 4 分钟前 / 3 小时前”；一天以上回到绝对时间；未来时间（时钟偏差）也按绝对时间，不写“负秒前” */
export function formatRelative(unixSec: number, now: Date = new Date()): string {
  const diff = Math.floor(now.getTime() / MS_PER_SECOND) - unixSec;
  if (diff < 0) return formatDateTime(unixSec, now);
  if (diff < SECONDS_PER_MINUTE) return `${diff} 秒前`;
  const minutes = Math.floor(diff / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  return hours < HOURS_PER_DAY ? `${hours} 小时前` : formatDateTime(unixSec, now);
}
