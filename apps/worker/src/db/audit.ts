export type AuditEntry = {
  actor_user_id: number | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  /** 已序列化的 JSON；不得包含密码、令牌等秘密 */
  detail: string | null;
  ip: string | null;
  created_at: number;
};

export async function insertAuditLog(db: D1Database, entry: AuditEntry): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, detail, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(entry.actor_user_id, entry.action, entry.target_type, entry.target_id, entry.detail, entry.ip, entry.created_at)
    .run();
}
