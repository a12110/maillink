/** `/inbox?mailbox=<收件地址 id>&id=<邮件 id>`：不带 mailbox = “全部”；id 是选中的邮件（窄屏进入详情） */
export type InboxSearch = { mailbox?: number; id?: number };

function positiveInt(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** 路由 validateSearch：非法值丢弃（不抛错，坏链接退化成“全部”） */
export function parseInboxSearch(raw: Record<string, unknown>): InboxSearch {
  const mailbox = positiveInt(raw.mailbox);
  const id = positiveInt(raw.id);
  return { ...(mailbox === undefined ? {} : { mailbox }), ...(id === undefined ? {} : { id }) };
}
