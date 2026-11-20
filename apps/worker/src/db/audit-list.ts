import type { AuditLog, AuditLogList, AuditLogListQuery } from "@maillink/shared";
import { redactSensitive } from "../audit-redact";
import { LIST_PAGE_SIZE } from "../constants";

// 审计日志列表（只读）。执行者用户名取自 users 的 LEFT JOIN：用户被删后为 null，日志本身保留。

type AuditListRow = {
  id: number;
  actor_user_id: number | null;
  actor_username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  ip: string | null;
  created_at: number;
};

function buildFilter(query: AuditLogListQuery): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (condition: string, value: unknown): void => {
    params.push(value);
    conditions.push(`${condition} ?${params.length}`);
  };
  if (query.action !== undefined) add("a.action =", query.action);
  if (query.actor_user_id !== undefined) add("a.actor_user_id =", query.actor_user_id);
  if (query.target_type !== undefined) add("a.target_type =", query.target_type);
  if (query.target_id !== undefined) add("a.target_id =", query.target_id);
  if (query.since !== undefined) add("a.created_at >=", query.since);
  if (query.until !== undefined) add("a.created_at <=", query.until);
  if (query.cursor !== undefined) add("a.id <", Number(query.cursor));
  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

/** detail 在库里是 JSON 文本；解析失败说明数据被改坏，抛出而不是返回残缺内容。返回前剔除敏感键 */
function toAuditLog(row: AuditListRow): AuditLog {
  return { ...row, detail: row.detail === null ? null : redactSensitive(JSON.parse(row.detail) as unknown) };
}

export async function listAuditLogs(db: D1Database, query: AuditLogListQuery): Promise<AuditLogList> {
  const limit = query.limit ?? LIST_PAGE_SIZE;
  const { where, params } = buildFilter(query);
  const { results } = await db
    .prepare(
      `SELECT a.id, a.actor_user_id, u.username AS actor_username, a.action, a.target_type, a.target_id,
              a.detail, a.ip, a.created_at
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
       ${where} ORDER BY a.id DESC LIMIT ?${params.length + 1}`,
    )
    .bind(...params, limit + 1)
    .all<AuditListRow>();
  const items = results.slice(0, limit).map(toAuditLog);
  const last = items[items.length - 1];
  return { items, next_cursor: results.length > limit && last ? String(last.id) : null };
}
