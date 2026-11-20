import { requireMailSchema } from "./guard";

/** 整个 MAIL_DB 里最大的邮件 id（没有邮件为 0），只读。id 单调递增，用作"此刻之前入库的邮件"的快照上界 */
export async function latestMailId(db: D1Database): Promise<number> {
  await requireMailSchema(db);
  const row = await db.prepare("SELECT MAX(id) AS id FROM raw_mails").first<{ id: number | null }>();
  return row?.id ?? 0;
}
