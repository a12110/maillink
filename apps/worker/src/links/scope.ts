import { compileStoredPolicy, type AccessScope } from "../access";
import { listLinkMailboxes, type ShareLinkRow } from "../db/share-links";
import type { CompiledRuleGroup, TimeAnchors } from "../rules";

// 链接的取件作用域（02 §5 resolveScope）：收件地址 + 编译后的规则组 + 锚点。

export function linkAnchors(row: Pick<ShareLinkRow, "created_at" | "first_access_at" | "anchor_reset_at">): TimeAnchors {
  return { created_at: row.created_at, first_access_at: row.first_access_at, anchor_reset_at: row.anchor_reset_at };
}

export type LinkScope = { scope: AccessScope; compiled: CompiledRuleGroup; mailboxCount: number };

/**
 * 只取启用中的收件地址（停用的地址不再对外提供邮件）；一个都没有时由调用方返回"无可用邮箱"。
 * 规则组编译失败由 compileStoredPolicy 抛 503（02 §5 失败关闭）。
 */
export async function loadLinkScope(db: D1Database, row: ShareLinkRow): Promise<LinkScope> {
  const compiled = compileStoredPolicy(row.rule_group_config);
  const mailboxes = await listLinkMailboxes(db, [row.id]);
  const addresses = mailboxes.filter((mailbox) => mailbox.status === "active").map((mailbox) => mailbox.address);
  return { scope: { addresses, policy: compiled, anchors: linkAnchors(row) }, compiled, mailboxCount: addresses.length };
}
