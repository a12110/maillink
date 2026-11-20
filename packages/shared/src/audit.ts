import { z } from "zod";
import { LIST_PAGE_SIZE_MAX } from "./limits";
import { listResponseSchema } from "./http";

const AUDIT_ACTION_MAX_LENGTH = 64;
const AUDIT_TARGET_TYPE_MAX_LENGTH = 32;
const AUDIT_TARGET_ID_MAX_LENGTH = 64;

const unixSeconds = z.coerce.number().int().nonnegative();

/** GET /api/admin/audit-logs 的查询参数；时间范围为 Unix 秒，含边界 */
export const auditLogListQuerySchema = z
  .object({
    action: z.string().trim().min(1).max(AUDIT_ACTION_MAX_LENGTH).optional(),
    actor_user_id: z.coerce.number().int().positive().optional(),
    target_type: z.string().trim().min(1).max(AUDIT_TARGET_TYPE_MAX_LENGTH).optional(),
    target_id: z.string().trim().min(1).max(AUDIT_TARGET_ID_MAX_LENGTH).optional(),
    since: unixSeconds.optional(),
    until: unixSeconds.optional(),
    cursor: z.string().regex(/^\d+$/, "cursor 无效").optional(),
    limit: z.coerce.number().int().min(1).max(LIST_PAGE_SIZE_MAX).optional(),
  })
  .refine((query) => query.since === undefined || query.until === undefined || query.since <= query.until, {
    message: "since 不能晚于 until",
  });
export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;

export const auditLogSchema = z.object({
  id: z.number().int(),
  actor_user_id: z.number().int().nullable(),
  /** 执行者当前的用户名；登录失败等无执行者，或用户已被删除时为 null */
  actor_username: z.string().nullable(),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  /** 写入时序列化的 JSON，已解析；不含密码、令牌 */
  detail: z.unknown().nullable(),
  ip: z.string().nullable(),
  created_at: z.number().int(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

export const auditLogListSchema = listResponseSchema(auditLogSchema);
export type AuditLogList = z.infer<typeof auditLogListSchema>;
