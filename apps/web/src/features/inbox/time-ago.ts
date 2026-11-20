const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;

/** 收到超过这么久的验证码弱化显示并标注可能已过期（DESIGN.md、05 §3：10 分钟） */
export const CODE_STALE_AFTER_SEC = 600;

/** “多久之前”：32 秒前 / 5 分钟前 / 3 小时前 / 2 天前。时间在未来（时钟偏差）按“刚刚” */
export function formatAgo(receivedAt: number, nowSec: number): string {
  const diff = Math.max(0, nowSec - receivedAt);
  if (diff < SECONDS_PER_MINUTE) return diff < 5 ? "刚刚" : `${diff} 秒前`;
  if (diff < SECONDS_PER_HOUR) return `${Math.floor(diff / SECONDS_PER_MINUTE)} 分钟前`;
  if (diff < SECONDS_PER_DAY) return `${Math.floor(diff / SECONDS_PER_HOUR)} 小时前`;
  return `${Math.floor(diff / SECONDS_PER_DAY)} 天前`;
}

export function isStaleCode(receivedAt: number, nowSec: number): boolean {
  return nowSec - receivedAt > CODE_STALE_AFTER_SEC;
}
