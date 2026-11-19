// MAIL_DB 里 created_at 是 SQLite CURRENT_TIMESTAMP 产生的 UTC 文本：`YYYY-MM-DD HH:MM:SS`。
// 与它比较的时间必须是同格式文本，因此所有转换只能走这里，别处不许手拼。
// 注意：本文件会被本地种子脚本用 Node 直接加载，不要引入扩展名缺失的相对 import。

const D1_UTC_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** 0000-01-01 00:00:00 UTC */
const MIN_MS = -62_167_219_200_000;
/** 9999-12-31 23:59:59.999 UTC */
const MAX_MS = 253_402_300_799_999;

const MS_PER_SECOND = 1000;
/** `YYYY-MM-DD HH:MM:SS` 的固定长度 */
const D1_UTC_LENGTH = 19;

function assertInRange(ms: number, caller: string): void {
  if (!Number.isFinite(ms) || ms < MIN_MS || ms > MAX_MS) {
    throw new RangeError(`${caller}: 时间超出 0000–9999 年范围: ${ms}`);
  }
}

/** 毫秒时间戳 → D1 文本。向下取整到秒（与 created_at 的精度一致） */
export function formatD1Utc(ms: number): string {
  assertInRange(ms, "formatD1Utc");
  const floored = Math.floor(ms / MS_PER_SECOND) * MS_PER_SECOND;
  return new Date(floored).toISOString().slice(0, D1_UTC_LENGTH).replace("T", " ");
}

/** D1 文本 → 毫秒时间戳。格式不符或日期不存在（如 02-30）时抛 RangeError */
export function parseD1Utc(text: string): number {
  const match = D1_UTC_PATTERN.exec(text);
  if (!match) {
    throw new RangeError(`parseD1Utc: 不是 YYYY-MM-DD HH:MM:SS 格式: ${JSON.stringify(text)}`);
  }
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = match
    .slice(1)
    .map(Number);
  const date = new Date(0);
  // Date.UTC 会把 0–99 年映射到 1900+，所以用 setUTCFullYear
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  const ms = date.getTime();
  assertInRange(ms, "parseD1Utc");
  // 往返比对，拒绝 13 月、2 月 30 日、25 时这类会被 Date 自动进位的输入
  if (formatD1Utc(ms) !== text) {
    throw new RangeError(`parseD1Utc: 日期或时间不存在: ${JSON.stringify(text)}`);
  }
  return ms;
}
