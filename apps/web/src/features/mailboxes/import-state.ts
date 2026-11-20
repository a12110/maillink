import { MAILBOX_LIMITS } from "@maillink/shared";
import type { MailboxImportItem, MailboxImportResponse } from "@maillink/shared";

/** 导入前的本地检查：与后端 mailboxImportRequestSchema 的上限一致，超限不发请求 */
export function checkImportInput(text: string): string | null {
  if (text.trim() === "") return "请粘贴地址，或上传 CSV / 文本文件";
  if (text.length > MAILBOX_LIMITS.importMaxChars) {
    return `内容超过 ${MAILBOX_LIMITS.importMaxChars.toLocaleString("en-US")} 个字符，请分批导入`;
  }
  const lines = text.split(/\r\n|\r|\n/u).filter((line) => line.trim() !== "").length;
  if (lines > MAILBOX_LIMITS.importMaxLines) {
    return `共 ${lines} 行，超过一次最多 ${MAILBOX_LIMITS.importMaxLines} 行，请分批导入`;
  }
  return null;
}

export type ImportGroups = Record<MailboxImportItem["status"], MailboxImportItem[]>;

export function groupImportItems(items: readonly MailboxImportItem[]): ImportGroups {
  const groups: ImportGroups = { new: [], duplicate: [], invalid: [] };
  for (const item of items) groups[item.status].push(item);
  return groups;
}

/** 正式导入的实际结果与预览不一致（并发导入抢先写入）时给出差异说明；一致返回 null */
export function describeImportDrift(preview: MailboxImportResponse, done: MailboxImportResponse): string | null {
  if (preview.summary.new === done.summary.new) return null;
  const lost = preview.summary.new - done.summary.new;
  return `预览时有 ${preview.summary.new} 个新增，实际写入 ${done.summary.new} 个：${lost} 个地址在你确认前已被别处导入。`;
}
