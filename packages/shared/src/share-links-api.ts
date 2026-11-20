import { z } from "zod";
import { LIST_PAGE_SIZE_MAX, SEARCH_KEYWORD_MAX_LENGTH } from "./limits";
import { MAX_UNIX_SECONDS } from "./mails";
import { ruleGroupTestItemSchema } from "./rule-groups-api";
import { linkAccessInputSchema, linkAccessViewSchema } from "./share-link-access";

// 管理端"取件链接"的请求与响应（04 管理端 / 取件链接）。

export const SHARE_LINK_LIMITS = {
  nameMaxLength: 100,
  orderRefMaxLength: 100,
  publicTitleMaxLength: 100,
  publicNoteMaxLength: 2000,
  /** 与 worker constants 的 MAX_MAILBOXES_PER_LINK 一致（有测试保证） */
  mailboxesPerLink: 50,
  /** 一次批量创建（一址一链）最多的收件地址数 */
  createMaxMailboxes: 500,
  batchMaxIds: 500,
  exportMaxIds: 2000,
  templateMaxLength: 500,
  /** 延长有效期 / 首次访问后有效期的上限：10 年 */
  durationMaxSec: 10 * 365 * 24 * 60 * 60,
  previewDefaultMails: 20,
  previewMaxMails: 100,
  /** 预览里列出的设备与取码记录条数 */
  previewRecordsMax: 100,
} as const;

/** 库里的状态（01 §5） */
export const SHARE_LINK_STATUSES = ["active", "paused", "revoked"] as const;
export type ShareLinkStatus = (typeof SHARE_LINK_STATUSES)[number];

/** 列表展示与筛选用的派生状态：生效 / 未到生效时间 / 已过期 / 次数用尽 / 暂停 / 撤销 */
export const SHARE_LINK_STATES = ["active", "pending", "expired", "exhausted", "paused", "revoked"] as const;
export type ShareLinkState = (typeof SHARE_LINK_STATES)[number];

/** 列表异常标记（规则见 worker constants 的 LINK_ANOMALY_*） */
export const SHARE_LINK_ANOMALIES = ["device_limit_reached", "multi_country"] as const;
export type ShareLinkAnomaly = (typeof SHARE_LINK_ANOMALIES)[number];

export const SHARE_LINK_CREATE_MODES = ["per_mailbox", "combined"] as const;
export const SHARE_LINK_BATCH_ACTIONS = ["extend", "pause", "resume", "revoke", "set_rule_group"] as const;
export const SHARE_LINK_EXPORT_FORMATS = ["csv", "template"] as const;
/** 行模板可用的变量 */
export const SHARE_LINK_TEMPLATE_VARIABLES = ["address", "link", "note", "name", "order_ref"] as const;

const unixSeconds = z.number().int().nonnegative().max(MAX_UNIX_SECONDS);
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const idSchema = z.number().int().positive();
const uniqueIds = (max: number) =>
  z
    .array(idSchema)
    .min(1)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, "id 不能重复");
const durationSchema = z.number().int().min(1).max(SHARE_LINK_LIMITS.durationMaxSec);

const editableFields = {
  name: nullableText(SHARE_LINK_LIMITS.nameMaxLength).optional(),
  order_ref: nullableText(SHARE_LINK_LIMITS.orderRefMaxLength).optional(),
  public_title: nullableText(SHARE_LINK_LIMITS.publicTitleMaxLength).optional(),
  public_note: nullableText(SHARE_LINK_LIMITS.publicNoteMaxLength).optional(),
  valid_from: unixSeconds.nullable().optional(),
  expires_at: unixSeconds.nullable().optional(),
  /** 首次"开始取码"后多少秒失效 */
  expire_after_first_access_sec: durationSchema.nullable().optional(),
};

function validWindow(body: { valid_from?: number | null; expires_at?: number | null }): boolean {
  return body.valid_from == null || body.expires_at == null || body.valid_from < body.expires_at;
}
const windowMessage = { message: "valid_from 必须早于 expires_at", path: ["expires_at"] };

export const shareLinkCreateSchema = z
  .strictObject({
    /** per_mailbox：一址一链（默认）；combined：一链多址（≤ mailboxesPerLink） */
    mode: z.enum(SHARE_LINK_CREATE_MODES).default("per_mailbox"),
    mailbox_ids: uniqueIds(SHARE_LINK_LIMITS.createMaxMailboxes),
    rule_group_id: idSchema,
    status: z.enum(["active", "paused"]).default("active"),
    ...editableFields,
    access: linkAccessInputSchema.prefault({}),
  })
  .refine(validWindow, windowMessage)
  .refine((body) => body.mode !== "combined" || body.mailbox_ids.length <= SHARE_LINK_LIMITS.mailboxesPerLink, {
    message: `一个链接最多绑定 ${SHARE_LINK_LIMITS.mailboxesPerLink} 个收件地址`,
    path: ["mailbox_ids"],
  });
export type ShareLinkCreate = z.input<typeof shareLinkCreateSchema>;

export const shareLinkUpdateSchema = z
  .strictObject({
    ...editableFields,
    status: z.enum(SHARE_LINK_STATUSES).optional(),
    rule_group_id: idSchema.optional(),
    access: linkAccessInputSchema.optional(),
  })
  .refine(validWindow, windowMessage);
export type ShareLinkUpdate = z.input<typeof shareLinkUpdateSchema>;

export const shareLinkListQuerySchema = z.object({
  state: z.enum(SHARE_LINK_STATES).optional(),
  rule_group_id: z.coerce.number().int().positive().optional(),
  mailbox_id: z.coerce.number().int().positive().optional(),
  /** 订单号子串（不区分大小写） */
  order_ref: z.string().trim().min(1).max(SHARE_LINK_LIMITS.orderRefMaxLength).optional(),
  /** 关键词：名称、订单号、收件地址子串 */
  q: z.string().trim().min(1).max(SEARCH_KEYWORD_MAX_LENGTH).optional(),
  cursor: z.string().regex(/^[1-9]\d{0,14}$/u, "cursor 无效").optional(),
  limit: z.coerce.number().int().min(1).max(LIST_PAGE_SIZE_MAX).optional(),
});
export type ShareLinkListQuery = z.infer<typeof shareLinkListQuerySchema>;

export const adminShareLinkSchema = z.object({
  id: z.number().int(),
  name: z.string().nullable(),
  order_ref: z.string().nullable(),
  public_title: z.string().nullable(),
  public_note: z.string().nullable(),
  /** token 前 6 位，仅供辨认；完整链接走 GET /:id/token */
  token_hint: z.string(),
  rule_group: z.object({ id: z.number().int(), name: z.string() }),
  status: z.enum(SHARE_LINK_STATUSES),
  state: z.enum(SHARE_LINK_STATES),
  valid_from: z.number().int().nullable(),
  expires_at: z.number().int().nullable(),
  expire_after_first_access_sec: z.number().int().nullable(),
  /** expires_at 与 first_access_at + expire_after_first_access_sec 中较早者；未激活且无绝对过期时为 null */
  effective_expires_at: z.number().int().nullable(),
  access: linkAccessViewSchema,
  anchor_reset_at: z.number().int().nullable(),
  first_access_at: z.number().int().nullable(),
  last_access_at: z.number().int().nullable(),
  mailboxes: z.array(z.object({ id: z.number().int(), address: z.string(), status: z.string() })),
  device_count: z.number().int(),
  country_count: z.number().int(),
  deliveries_24h: z.number().int(),
  deliveries_total: z.number().int(),
  anomalies: z.array(z.enum(SHARE_LINK_ANOMALIES)),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export type AdminShareLink = z.infer<typeof adminShareLinkSchema>;

export const shareLinkListResponseSchema = z.object({
  items: z.array(adminShareLinkSchema),
  next_cursor: z.string().nullable(),
  total: z.number().int(),
});
export type ShareLinkListResponse = z.infer<typeof shareLinkListResponseSchema>;

export const shareLinkTokenSchema = z.object({ token: z.string(), url: z.string() });
export type ShareLinkToken = z.infer<typeof shareLinkTokenSchema>;

export const shareLinkCreateResponseSchema = z.object({
  /** 完整 token 只在这里（与 rotate / GET token）出现 */
  items: z.array(z.object({ link: adminShareLinkSchema, token: z.string(), url: z.string() })),
  /** 收件地址已有生效链接的提示（共享号是正常情况，只提示不阻止） */
  warnings: z.array(z.object({ mailbox_id: z.number().int(), address: z.string(), active_link_count: z.number().int() })),
});
export type ShareLinkCreateResponse = z.infer<typeof shareLinkCreateResponseSchema>;

export const shareLinkRotateResponseSchema = shareLinkTokenSchema.extend({ link: adminShareLinkSchema });
export type ShareLinkRotateResponse = z.infer<typeof shareLinkRotateResponseSchema>;

const resetFlags = {
  /** 重置起始时间：anchor_reset_at = 现在 */
  reset_anchor: z.boolean().default(false),
  /** 清空设备（link_visitors） */
  reset_devices: z.boolean().default(false),
  /** 清空取码记录（link_deliveries） */
  reset_deliveries: z.boolean().default(false),
};

export const shareLinkRotateSchema = z.strictObject({
  /** 同时清空已登记的设备（链接外泄时用） */
  reset_devices: z.boolean().default(false),
});
export type ShareLinkRotate = z.input<typeof shareLinkRotateSchema>;

export const shareLinkRebindSchema = z.strictObject({
  mailbox_ids: uniqueIds(SHARE_LINK_LIMITS.mailboxesPerLink),
  ...resetFlags,
});
export type ShareLinkRebind = z.input<typeof shareLinkRebindSchema>;

export const shareLinkResetSchema = z
  .strictObject(resetFlags)
  .refine((body) => body.reset_anchor || body.reset_devices || body.reset_deliveries, "至少选择一项重置");
export type ShareLinkReset = z.input<typeof shareLinkResetSchema>;

const batchIds = uniqueIds(SHARE_LINK_LIMITS.batchMaxIds);

export const shareLinkBatchSchema = z.discriminatedUnion("action", [
  z.strictObject({ ids: batchIds, action: z.literal("pause") }),
  z.strictObject({ ids: batchIds, action: z.literal("resume") }),
  z.strictObject({ ids: batchIds, action: z.literal("revoke") }),
  /** 在当前截止时间（已过期的从现在算）上延长的秒数 */
  z.strictObject({ ids: batchIds, action: z.literal("extend"), extend_sec: durationSchema }),
  z.strictObject({ ids: batchIds, action: z.literal("set_rule_group"), rule_group_id: idSchema }),
]);
export type ShareLinkBatch = z.input<typeof shareLinkBatchSchema>;

export const shareLinkBatchResponseSchema = z.object({
  results: z.array(z.object({ id: z.number().int(), ok: z.boolean(), error: z.string().optional() })),
});
export type ShareLinkBatchResponse = z.infer<typeof shareLinkBatchResponseSchema>;

export const shareLinkExportSchema = z
  .strictObject({
    ids: uniqueIds(SHARE_LINK_LIMITS.exportMaxIds),
    format: z.enum(SHARE_LINK_EXPORT_FORMATS).default("csv"),
    /** format=template：每个链接一行，如 `{address}----{link}`；变量见 SHARE_LINK_TEMPLATE_VARIABLES */
    template: z.string().min(1).max(SHARE_LINK_LIMITS.templateMaxLength).optional(),
  })
  .refine((body) => (body.format === "template") === (body.template !== undefined), {
    message: "template 仅且必须在 format=template 时提供",
    path: ["template"],
  });
export type ShareLinkExport = z.input<typeof shareLinkExportSchema>;

export const shareLinkExportResponseSchema = z.object({
  format: z.enum(SHARE_LINK_EXPORT_FORMATS),
  /** CSV 首行为表头 address,note,link；多地址链接的地址与备注用 `;` 连接 */
  content: z.string(),
  count: z.number().int(),
});
export type ShareLinkExportResponse = z.infer<typeof shareLinkExportResponseSchema>;

export const LINK_LOG_EVENTS = ["start", "deliver", "download", "denied"] as const;

export const linkLogSchema = z.object({
  id: z.number().int(),
  event: z.enum(LINK_LOG_EVENTS),
  mail_id: z.number().int().nullable(),
  /** denied 的具体原因（对访问者统一显示"已失效"，这里给管理员看） */
  reason: z.string().nullable(),
  ip: z.string().nullable(),
  country: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: z.number().int(),
});
export type LinkLog = z.infer<typeof linkLogSchema>;

export const linkLogQuerySchema = z.object({
  cursor: z.string().regex(/^[1-9]\d{0,14}$/u, "cursor 无效").optional(),
  limit: z.coerce.number().int().min(1).max(LIST_PAGE_SIZE_MAX).optional(),
});

export const linkLogListResponseSchema = z.object({ items: z.array(linkLogSchema), next_cursor: z.string().nullable() });
export type LinkLogListResponse = z.infer<typeof linkLogListResponseSchema>;

export const linkVisitorSchema = z.object({
  /** visitor_hash 前 8 位，仅供辨认 */
  visitor: z.string(),
  first_seen_at: z.number().int(),
  last_seen_at: z.number().int(),
  ip: z.string().nullable(),
  country: z.string().nullable(),
  user_agent: z.string().nullable(),
});
export const linkDeliverySchema = z.object({ mail_id: z.number().int(), visitor: z.string(), delivered_at: z.number().int() });

export const linkPreviewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(SHARE_LINK_LIMITS.previewMaxMails).optional(),
});

export const linkPreviewResponseSchema = z.object({
  link: adminShareLinkSchema,
  time_lower_bound: z.number().int().nullable(),
  partial: z.boolean(),
  /** 逐封 trace（与规则组测试器同结构）；delivered：click 模式下是否已交付给本链接 */
  items: z.array(ruleGroupTestItemSchema.extend({ delivered: z.boolean() })),
  visitors: z.array(linkVisitorSchema),
  deliveries: z.array(linkDeliverySchema),
});
export type LinkPreviewResponse = z.infer<typeof linkPreviewResponseSchema>;
