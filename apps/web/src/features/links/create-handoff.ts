import { z } from "zod";
import type { PickedMailbox } from "./MailboxPicker";

// 收件地址页 →「生成取件链接」：URL 只带地址 id（create_for），地址文本走 sessionStorage 交接
// （500 个地址放进 URL 太长；刷新后仍在，创建对话框关闭时清掉）。取不到时地址显示成 #id，不编造。

const KEY = "maillink.links.create_for";
const handoffSchema = z.array(z.object({ id: z.number().int().positive(), address: z.string() }));

export function saveHandoff(mailboxes: ReadonlyArray<{ id: number; address: string }>): void {
  sessionStorage.setItem(KEY, JSON.stringify(mailboxes.map(({ id, address }) => ({ id, address }))));
}

export function clearHandoff(): void {
  sessionStorage.removeItem(KEY);
}

/** 按 URL 里的 id 顺序还原：交接里有地址的带上地址，其余 address 为 null */
export function resolveHandoff(ids: readonly number[]): PickedMailbox[] {
  const raw = sessionStorage.getItem(KEY);
  const parsed = raw === null ? null : handoffSchema.safeParse(JSON.parse(raw));
  const known = new Map((parsed?.success ? parsed.data : []).map((item) => [item.id, item.address]));
  return ids.map((id) => ({ id, address: known.get(id) ?? null }));
}
