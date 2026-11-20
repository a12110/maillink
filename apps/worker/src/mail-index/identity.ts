import type { MailCandidate } from "../mail-source";

/**
 * 邮件身份：temp_email 删除邮件后，新邮件可能复用同一个 id；id 相同但这三项任一不同就是另一封。
 * mail_index 判定索引行是否过期（isFresh）与取件链接的取码记录（link_deliveries）共用这一口径。
 */
export type MailIdentity = Pick<MailCandidate, "message_id" | "received_at" | "recipient">;

export function mailIdentity(source: MailIdentity): MailIdentity {
  return { message_id: source.message_id, received_at: source.received_at, recipient: source.recipient };
}

export function sameMailIdentity(a: MailIdentity, b: MailIdentity): boolean {
  return a.message_id === b.message_id && a.received_at === b.received_at && a.recipient === b.recipient;
}
