import { MAILBOX_LIMITS } from "@maillink/shared";
import type { AdminMailbox, MailboxBatchResponse } from "@maillink/shared";
import { BATCH_ERROR_LABEL } from "./labels";

export type BatchFailure = { id: number; address: string; reason: string };
export type BatchSummary = { ok: number; failures: BatchFailure[] };

/** 把逐条结果归并成“成功几个 + 失败清单（带地址与原因）”，失败不被吞成一个总数 */
export function summarizeBatch(results: MailboxBatchResponse["results"], selected: ReadonlyMap<number, AdminMailbox>): BatchSummary {
  const failures: BatchFailure[] = [];
  let ok = 0;
  for (const result of results) {
    if (result.ok) {
      ok += 1;
      continue;
    }
    failures.push({
      id: result.id,
      address: selected.get(result.id)?.address ?? `#${result.id}`,
      reason: result.error === null ? "未知原因" : BATCH_ERROR_LABEL[result.error],
    });
  }
  return { ok, failures };
}

/** 删除确认里写出后果：选中地址上的链接与授权会随之级联删除 */
export function deleteConsequence(selected: ReadonlyMap<number, AdminMailbox>): string {
  let links = 0;
  let grants = 0;
  for (const mailbox of selected.values()) {
    links += mailbox.link_count;
    grants += mailbox.grant_count;
  }
  const cascade = links + grants > 0 ? `这些地址上的 ${links} 个取件链接和 ${grants} 个授权也会一并删除，` : "";
  return `将永久删除 ${selected.size} 个收件地址。${cascade}无法撤销；MAIL_DB 里的邮件本身不受影响。`;
}

/** 「选择全部」能一次性选中的上限：后端批量接口一次最多这么多个 */
export const SELECT_ALL_LIMIT = MAILBOX_LIMITS.batchMaxIds;
