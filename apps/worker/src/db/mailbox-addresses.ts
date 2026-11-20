import { IMPORTED_SCOPE_MAX_ADDRESSES } from "../constants";

/**
 * 已导入且启用的收件地址（mailboxes.address，域名小写），供预热使用。
 * 数量超过范围过滤的上限时明确报错，不静默截断：截断会让一部分地址永远不被预热。
 */
export async function listActiveMailboxAddresses(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT address FROM mailboxes WHERE status = 'active' ORDER BY id LIMIT ?1")
    .bind(IMPORTED_SCOPE_MAX_ADDRESSES + 1)
    .all<{ address: string }>();
  if (results.length > IMPORTED_SCOPE_MAX_ADDRESSES) {
    throw new Error(`启用的收件地址超过 ${IMPORTED_SCOPE_MAX_ADDRESSES} 个，预热无法一次传给 MAIL_DB`);
  }
  return results.map((row) => row.address);
}
