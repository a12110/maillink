/** mail_index 总行数（系统状态展示用） */
export async function countMailIndexRows(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS total FROM mail_index").first<{ total: number }>();
  return row?.total ?? 0;
}
