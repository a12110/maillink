import { MS_PER_SECOND } from "../../constants";
import { formatDateTime } from "../../lib/format";

const SEC_PER_MIN = 60;
const SEC_PER_HOUR = 3600;
const SEC_PER_DAY = 86_400;
const JUST_NOW_SEC = 10;

export function nowSeconds(): number {
  return Math.floor(Date.now() / MS_PER_SECOND);
}

/** 链接剩余有效时间：「2 天 3 小时」「5 小时 12 分钟」「8 分钟」；已到期返回 null */
export function formatRemaining(expiresAt: number, now: number): string | null {
  const left = expiresAt - now;
  if (left <= 0) return null;
  if (left < SEC_PER_MIN) return "不足 1 分钟";
  const days = Math.floor(left / SEC_PER_DAY);
  const hours = Math.floor((left % SEC_PER_DAY) / SEC_PER_HOUR);
  const minutes = Math.floor((left % SEC_PER_HOUR) / SEC_PER_MIN);
  if (days > 0) return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`;
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
  return `${minutes} 分钟`;
}

/** 「约 5 小时 40 分钟后」：每日上限恢复时间的人读写法 */
export function formatCountdown(target: number, now: number): string {
  const left = Math.max(0, target - now);
  if (left < SEC_PER_MIN) return "不到 1 分钟";
  const hours = Math.floor(left / SEC_PER_HOUR);
  const minutes = Math.ceil((left % SEC_PER_HOUR) / SEC_PER_MIN);
  if (hours === 0) return `${minutes} 分钟`;
  return minutes === 0 || minutes === SEC_PER_MIN ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
}

/** 「32 秒前」「8 分钟前」「3 小时前」，超过一天给绝对时间。本机时钟比服务器快时按「刚刚」 */
export function formatAgo(receivedAt: number, now: number): string {
  const diff = now - receivedAt;
  if (diff < JUST_NOW_SEC) return "刚刚";
  if (diff < SEC_PER_MIN) return `${diff} 秒前`;
  if (diff < SEC_PER_HOUR) return `${Math.floor(diff / SEC_PER_MIN)} 分钟前`;
  if (diff < SEC_PER_DAY) return `${Math.floor(diff / SEC_PER_HOUR)} 小时前`;
  return formatDateTime(receivedAt, new Date(now * MS_PER_SECOND));
}

export function isStale(receivedAt: number, now: number, staleAfterSec: number): boolean {
  return now - receivedAt > staleAfterSec;
}

/** 时长的人读写法：「3 天」「12 小时」「30 分钟」 */
export function formatSpan(seconds: number): string {
  if (seconds >= SEC_PER_DAY && seconds % SEC_PER_DAY === 0) return `${seconds / SEC_PER_DAY} 天`;
  if (seconds >= SEC_PER_HOUR && seconds % SEC_PER_HOUR === 0) return `${seconds / SEC_PER_HOUR} 小时`;
  if (seconds >= SEC_PER_HOUR) return `${Math.floor(seconds / SEC_PER_HOUR)} 小时 ${Math.round((seconds % SEC_PER_HOUR) / SEC_PER_MIN)} 分钟`;
  return `${Math.max(1, Math.round(seconds / SEC_PER_MIN))} 分钟`;
}
