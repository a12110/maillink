import { IMPORTED_SCOPE_MAX_ADDRESSES } from "../constants";

/**
 * 已导入的收件地址（mailboxes.address，域名小写）。
 * 多取一个：数量超过范围过滤的上限时，让 mail-source 能据此报错，又不必把几十万行全读出来。
 */
export async function listImportedAddresses(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT address FROM mailboxes ORDER BY id LIMIT ?1")
    .bind(IMPORTED_SCOPE_MAX_ADDRESSES + 1)
    .all<{ address: string }>();
  return results.map((row) => row.address);
}
