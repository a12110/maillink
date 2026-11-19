// limits.max_mails（02 §3.1）：过滤后只保留最新的 N 封，没有更多分页。
// "最新"按 received_at 降序、同一秒按 mail_id 降序。不修改入参。

export type NewestOrdered = { mail_id: number; received_at: number };

export function limitToNewest<T extends NewestOrdered>(visible: readonly T[], maxMails: number | undefined): T[] {
  const sorted = [...visible].sort((a, b) => b.received_at - a.received_at || b.mail_id - a.mail_id);
  if (maxMails === undefined) return sorted;
  if (!Number.isSafeInteger(maxMails) || maxMails < 1) throw new RangeError(`max_mails 必须是正整数，实际是 ${maxMails}`);
  return sorted.slice(0, maxMails);
}
