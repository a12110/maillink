import type { CodeSource, MailCategory } from "@maillink/shared";

export const CATEGORY_LABEL: Record<MailCategory, string> = {
  email_change: "更换邮箱",
  password_reset: "重设密码",
  security_change: "安全变更",
  billing: "账单",
  verification: "验证",
  other: "其他",
};

export const CODE_SOURCE_LABEL: Record<CodeSource, string> = {
  ai_extract: "temp_email 的 AI 提取",
  builtin: "内置提取",
};

const BYTES_PER_KIB = 1024;
const SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;
const SMALL_UNIT_LIMIT = 10;

/** 字节数 → 人读大小：1536 → "1.5 KB" */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= BYTES_PER_KIB && unit < SIZE_UNITS.length - 1) {
    value /= BYTES_PER_KIB;
    unit += 1;
  }
  const text = unit > 0 && value < SMALL_UNIT_LIMIT ? value.toFixed(1) : String(Math.round(value));
  return `${text} ${SIZE_UNITS[unit]}`;
}

/** 只有 http(s) 链接才渲染成可点的 <a>（PLAN「邮件 HTML 展示的硬性要求」第 5 条）；其余一律当纯文本 */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

/** 发件人展示：`名称 <地址>`；只有一项时只显示那一项 */
export function formatSender(sender: { address: string | null; name: string | null } | null): string | null {
  if (!sender) return null;
  if (sender.name && sender.address) return `${sender.name} <${sender.address}>`;
  return sender.name ?? sender.address;
}
