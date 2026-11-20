import type { MAILBOX_IMPORT_REASONS, MailboxBatchResponse, MailboxImportItem, MailboxStatus } from "@maillink/shared";

export const STATUS_LABEL: Record<MailboxStatus, string> = { active: "启用", disabled: "已停用" };

export type ImportReason = (typeof MAILBOX_IMPORT_REASONS)[number];

export const IMPORT_REASON_LABEL: Record<ImportReason, string> = {
  invalid_format: "不是合法的邮箱地址",
  too_long: "地址过长",
  invalid_tag: "标签不合法（不能含空白、逗号、分号或竖线，最长 32 个字符）",
  too_many_tags: "标签数量超过上限（每个地址最多 20 个）",
  note_too_long: "备注超过 500 个字符",
  duplicate_in_input: "本次导入内重复（只保留第一次出现）",
  already_exists: "已经导入过",
};

export function importReasonLabel(item: MailboxImportItem): string {
  return item.reason === null ? "" : IMPORT_REASON_LABEL[item.reason];
}

type BatchError = NonNullable<MailboxBatchResponse["results"][number]["error"]>;

export const BATCH_ERROR_LABEL: Record<BatchError, string> = {
  not_found: "地址已不存在（可能被别处删除）",
  too_many_tags: "标签数量会超过每个地址 20 个的上限",
};
