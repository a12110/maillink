import type { AuditEntry } from "./audit";

/** 审计写入的预编译语句，供需要与业务写入放进同一个 db.batch（同一事务）的调用方使用；列与 insertAuditLog 一致 */
export function auditLogStatement(db: D1Database, entry: AuditEntry): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, detail, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(entry.actor_user_id, entry.action, entry.target_type, entry.target_id, entry.detail, entry.ip, entry.created_at);
}
