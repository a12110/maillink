// mail_index 的维护查询（APP_DB，每日清理用）。

/** 按 mail_id 正序取 afterId 之后的一批 id */
export async function listIndexedIdsAfter(db: D1Database, afterId: number, limit: number): Promise<number[]> {
  const { results } = await db
    .prepare("SELECT mail_id FROM mail_index WHERE mail_id > ?1 ORDER BY mail_id LIMIT ?2")
    .bind(afterId, limit)
    .all<{ mail_id: number }>();
  return results.map((row) => row.mail_id);
}

export async function deleteIndexRows(db: D1Database, ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db
    .prepare("DELETE FROM mail_index WHERE mail_id IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify(ids))
    .run();
  return result.meta.changes;
}
