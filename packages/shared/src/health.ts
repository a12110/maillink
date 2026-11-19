import { z } from "zod";

/** MAIL_DB 中 raw_mails 的可选列对应的能力标记，见 01 §3.1 */
export const mailCapabilitiesSchema = z.object({
  /** 有 to_address 列：可按 iCloud 别名匹配；否则只能按 address 匹配 */
  to_address: z.boolean(),
  /** 有 raw_blob 列：可能存在 gzip 正文 */
  raw_blob: z.boolean(),
  /** 有 metadata 列：可读取 temp_email 的提取结果 */
  metadata: z.boolean(),
});
export type MailCapabilities = z.infer<typeof mailCapabilitiesSchema>;

/** MAIL_DB 的 schema 探测结果 */
export const mailSchemaProbeSchema = z.object({
  /** 必需列齐全才为 true */
  healthy: z.boolean(),
  /** raw_mails 表是否存在 */
  table_exists: z.boolean(),
  /** raw_mails 实际存在的列名 */
  columns: z.array(z.string()),
  /** 缺失的必需列 */
  missing_required: z.array(z.string()),
  capabilities: mailCapabilitiesSchema,
  /** settings.db_version；表或键不存在时为 null */
  db_version: z.string().nullable(),
  /** 需要管理员注意的降级提示（如缺 to_address） */
  warnings: z.array(z.string()),
});
export type MailSchemaProbe = z.infer<typeof mailSchemaProbeSchema>;

/** GET /api/admin/system/health 响应 */
export const healthResponseSchema = z.object({
  ok: z.boolean(),
  app_db: z.object({
    ok: z.boolean(),
    error: z.string().nullable(),
  }),
  mail_db: z.object({
    ok: z.boolean(),
    error: z.string().nullable(),
    probe: mailSchemaProbeSchema.nullable(),
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
