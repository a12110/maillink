import { requireMailSchema } from "./guard";

/**
 * 给定的 raw_mails.id 里哪些仍然存在（只读）。每日清理据此找出 mail_index 里已成孤儿的行。
 * ids 作为单个 JSON 数组参数传入，调用方分批（每批几百个）。
 * 先过 schema 守卫：MAIL_DB 不健康时抛 503，调用方不得把"查不到"当成"不存在"去删索引。
 */
export async function listExistingMailIds(db: D1Database, ids: readonly number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  await requireMailSchema(db);
  const { results } = await db
    .prepare("SELECT id FROM raw_mails WHERE id IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify(ids))
    .all<{ id: number }>();
  return new Set(results.map((row) => row.id));
}
