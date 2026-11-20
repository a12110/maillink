import { z } from "zod";
import { LIST_PAGE_SIZE_MAX } from "./limits";
import { mailboxStatusSchema } from "./mailboxes";
import { VIEW_MODES } from "./rule-group";

// 用户邮箱授权：管理端 /api/admin/grants* 与用户侧 /api/me/mailboxes（04 管理端 / 授权，当前用户）。

/** 批量授权一次最多的用户数、收件地址数，以及两者相乘的授权对数 */
export const GRANT_BATCH_MAX_USERS = 100;
export const GRANT_BATCH_MAX_MAILBOXES = 500;
export const GRANT_BATCH_MAX_PAIRS = 1000;

/** 过期时间的上限（2100-01-01，Unix 秒），挡掉毫秒时间戳之类的误填 */
export const GRANT_EXPIRES_AT_MAX = 4_102_444_800;

const idSchema = z.number().int().positive();
const expiresAtSchema = z.number().int().positive().max(GRANT_EXPIRES_AT_MAX);
const cursorSchema = z.string().regex(/^[1-9]\d{0,14}$/u, "cursor 无效");

export const adminGrantSchema = z.object({
  id: z.number().int(),
  user_id: z.number().int(),
  username: z.string(),
  mailbox_id: z.number().int(),
  address: z.string(),
  mailbox_status: mailboxStatusSchema,
  /** null = 完整访问（黑名单、无规则、full 视图） */
  rule_group_id: z.number().int().nullable(),
  rule_group_name: z.string().nullable(),
  expires_at: z.number().int().nullable(),
  /** expires_at 已过 */
  expired: z.boolean(),
  /** 用户此刻真的能看到：未过期且收件地址启用 */
  effective: z.boolean(),
  first_access_at: z.number().int().nullable(),
  created_at: z.number().int(),
});
export type AdminGrant = z.infer<typeof adminGrantSchema>;

export const adminGrantListQuerySchema = z
  .object({
    user_id: z.coerce.number().int().positive().optional(),
    mailbox_id: z.coerce.number().int().positive().optional(),
    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(LIST_PAGE_SIZE_MAX).optional(),
  })
  .refine((query) => query.user_id !== undefined || query.mailbox_id !== undefined, {
    message: "user_id 与 mailbox_id 至少要给一个",
    path: ["user_id"],
  });
export type AdminGrantListQuery = z.infer<typeof adminGrantListQuerySchema>;

export const adminGrantListResponseSchema = z.object({
  items: z.array(adminGrantSchema),
  next_cursor: z.string().nullable(),
});
export type AdminGrantListResponse = z.infer<typeof adminGrantListResponseSchema>;

export const GRANT_ON_CONFLICT = ["skip", "update"] as const;

export const grantBatchRequestSchema = z
  .object({
    user_ids: z.array(idSchema).min(1).max(GRANT_BATCH_MAX_USERS),
    mailbox_ids: z.array(idSchema).min(1).max(GRANT_BATCH_MAX_MAILBOXES),
    /** 必填：显式写 null 才是"完整访问"，漏写不会悄悄变成完整访问 */
    rule_group_id: idSchema.nullable(),
    expires_at: expiresAtSchema.nullable().default(null),
    /** 已有授权：skip 保持不动（默认）；update 改成本次的规则组与过期时间 */
    on_conflict: z.enum(GRANT_ON_CONFLICT).default("skip"),
  })
  .refine((body) => new Set(body.user_ids).size * new Set(body.mailbox_ids).size <= GRANT_BATCH_MAX_PAIRS, {
    message: `用户数 × 收件地址数不能超过 ${GRANT_BATCH_MAX_PAIRS}`,
    path: ["mailbox_ids"],
  });
export type GrantBatchRequest = z.input<typeof grantBatchRequestSchema>;

export const grantPatchSchema = z
  .object({
    rule_group_id: idSchema.nullable().optional(),
    expires_at: expiresAtSchema.nullable().optional(),
  })
  .refine((patch) => patch.rule_group_id !== undefined || patch.expires_at !== undefined, {
    message: "至少要修改一个字段",
  });
export type GrantPatch = z.input<typeof grantPatchSchema>;

export const GRANT_BATCH_STATUSES = ["created", "updated", "skipped", "failed"] as const;
/**
 * already_exists 已有授权且选择跳过；unchanged 已有授权且内容相同；
 * user_not_found / mailbox_not_found 目标不存在；grant_not_found 要更新的授权在处理中被别人删掉了
 */
export const GRANT_BATCH_REASONS = ["already_exists", "unchanged", "user_not_found", "mailbox_not_found", "grant_not_found"] as const;

export const grantBatchResultSchema = z.object({
  user_id: z.number().int(),
  mailbox_id: z.number().int(),
  status: z.enum(GRANT_BATCH_STATUSES),
  reason: z.enum(GRANT_BATCH_REASONS).nullable(),
  grant_id: z.number().int().nullable(),
});
export type GrantBatchResult = z.infer<typeof grantBatchResultSchema>;

export const grantBatchResponseSchema = z.object({
  summary: z.object({ created: z.number().int(), updated: z.number().int(), skipped: z.number().int(), failed: z.number().int() }),
  results: z.array(grantBatchResultSchema),
});
export type GrantBatchResponse = z.infer<typeof grantBatchResponseSchema>;

// ---- 用户侧 ----

export const MY_MAILBOX_RECIPIENT_MODES = ["full", "masked", "hidden"] as const;

/**
 * 当前用户的一个有效授权。`id` 是授权 id，前端用它切换邮箱（`/api/me/mails?mailbox=<id>`），不是收件地址 id。
 * recipient 为 hidden 时 address 与 label 都是 null，不暴露真实地址；规则组配置失效（available=false）时
 * 无从得知呈现设置，同样只给 id。
 */
export const myMailboxSchema = z.object({
  id: z.number().int(),
  address: z.string().nullable(),
  label: z.string().nullable(),
  recipient: z.enum(MY_MAILBOX_RECIPIENT_MODES).nullable(),
  /** 规则组的视图模式；code_only / meta_only 没有详情，前端据此不放详情入口 */
  view: z.enum(VIEW_MODES).nullable(),
  expires_at: z.number().int().nullable(),
  available: z.boolean(),
});
export type MyMailbox = z.infer<typeof myMailboxSchema>;

export const myMailboxListResponseSchema = z.object({
  items: z.array(myMailboxSchema),
  next_cursor: z.null(),
});
export type MyMailboxListResponse = z.infer<typeof myMailboxListResponseSchema>;

export const myMailListQuerySchema = z
  .object({
    /** 授权 id；不给 = "全部" */
    mailbox: z.coerce.number().int().positive().optional(),
    cursor: cursorSchema.optional(),
    after_id: z.coerce.number().int().min(0).optional(),
  })
  .refine((query) => query.cursor === undefined || query.after_id === undefined, {
    message: "cursor 与 after_id 不能同时使用",
    path: ["cursor"],
  });
export type MyMailListQuery = z.infer<typeof myMailListQuerySchema>;

export const myMailDetailQuerySchema = z.object({
  /** 授权 id；不给时按邮件的收件地址在当前用户的有效授权里定位 */
  mailbox: z.coerce.number().int().positive().optional(),
});
