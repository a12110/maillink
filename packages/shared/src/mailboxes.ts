import { z } from "zod";
import { EMAIL_MAX_LENGTH, LIST_PAGE_SIZE_MAX, SEARCH_KEYWORD_MAX_LENGTH } from "./limits";

// 管理端"收件地址"的请求与响应，见 docs/design/04-api.md 管理端 / 收件地址。

export const MAILBOX_STATUSES = ["active", "disabled"] as const;
export const mailboxStatusSchema = z.enum(MAILBOX_STATUSES);
export type MailboxStatus = z.infer<typeof mailboxStatusSchema>;

export const MAILBOX_LIMITS = {
  /** 单个标签的字符数 */
  tagMaxLength: 32,
  /** 每个收件地址的标签数 */
  tagsPerMailbox: 20,
  labelMaxLength: 100,
  noteMaxLength: 500,
  /** 一次导入的行数（含空行之外的所有行） */
  importMaxLines: 2000,
  /** 导入文本的总字符数 */
  importMaxChars: 1_000_000,
  /** 批量操作一次最多的收件地址数 */
  batchMaxIds: 500,
  /** 邮箱本地部分的长度（RFC 5321） */
  localPartMaxLength: 64,
  addressMaxLength: EMAIL_MAX_LENGTH,
} as const;

/** 标签：去掉首尾空白，不含空白与分隔符（导入时标签列用空白、`;`、`|` 分隔） */
export const mailboxTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAILBOX_LIMITS.tagMaxLength)
  .regex(/^[^\s,;|]+$/u, "标签不能包含空白、逗号、分号或竖线");

const tagsSchema = z.array(mailboxTagSchema).max(MAILBOX_LIMITS.tagsPerMailbox);
const nullableText = (max: number) => z.string().trim().max(max).nullable();

export const adminMailboxSchema = z.object({
  id: z.number().int(),
  /** 导入时的写法，域名小写 */
  address: z.string(),
  label: z.string().nullable(),
  note: z.string().nullable(),
  status: mailboxStatusSchema,
  tags: z.array(z.string()),
  link_count: z.number().int(),
  grant_count: z.number().int(),
  /** MAIL_DB 里这个地址最近一封邮件的入库时间（Unix 秒）；没有邮件为 null */
  last_received_at: z.number().int().nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export type AdminMailbox = z.infer<typeof adminMailboxSchema>;

export const adminMailboxListQuerySchema = z.object({
  /** 关键词：匹配地址、名称、备注（不区分大小写） */
  q: z.string().trim().min(1).max(SEARCH_KEYWORD_MAX_LENGTH).optional(),
  tag: mailboxTagSchema.optional(),
  status: mailboxStatusSchema.optional(),
  /** "true" 只看被至少一个取件链接引用的地址，"false" 只看没有被引用的 */
  has_link: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  cursor: z.string().regex(/^[1-9]\d{0,14}$/u, "cursor 无效").optional(),
  limit: z.coerce.number().int().min(1).max(LIST_PAGE_SIZE_MAX).optional(),
});
export type AdminMailboxListQuery = z.infer<typeof adminMailboxListQuerySchema>;

export const adminMailboxListResponseSchema = z.object({
  items: z.array(adminMailboxSchema),
  next_cursor: z.string().nullable(),
  /** 满足筛选条件的总数（不受游标影响），页头"共 N 个" */
  total: z.number().int(),
  /** 除 status 以外的筛选条件下的启用数与停用数（状态切换标签上显示的数字） */
  active_count: z.number().int(),
  disabled_count: z.number().int(),
});
export type AdminMailboxListResponse = z.infer<typeof adminMailboxListResponseSchema>;

/** GET /api/admin/mailboxes/tags：全部标签及使用次数，次数多的在前，同次数按标签名 */
export const mailboxTagCountSchema = z.object({ tag: z.string(), count: z.number().int() });
export type MailboxTagCount = z.infer<typeof mailboxTagCountSchema>;

export const mailboxTagListResponseSchema = z.object({
  items: z.array(mailboxTagCountSchema),
  /** 标签种类超过返回上限，只给出了前面的部分 */
  truncated: z.boolean(),
});
export type MailboxTagListResponse = z.infer<typeof mailboxTagListResponseSchema>;

export const mailboxImportRequestSchema = z.object({
  /**
   * 每行一个地址，可带备注与标签列：`地址[,备注[,标签]]`（逗号或制表符分隔，CSV 双引号转义）。
   * 标签列里多个标签用空白、`;` 或 `|` 分隔。首行是 address / 地址 表头时跳过。
   */
  content: z.string().min(1).max(MAILBOX_LIMITS.importMaxChars),
  /** 只返回预览，不写库 */
  dry_run: z.boolean().default(false),
  /** 给本次新增的全部地址追加的标签 */
  tags: tagsSchema.default([]),
});
export type MailboxImportRequest = z.input<typeof mailboxImportRequestSchema>;

export const MAILBOX_IMPORT_STATUSES = ["new", "duplicate", "invalid"] as const;

/** 逐条原因：invalid_format 格式不对；too_long 超长；invalid_tag 标签不合法；duplicate_in_input 本次重复；already_exists 已导入 */
export const MAILBOX_IMPORT_REASONS = [
  "invalid_format",
  "too_long",
  "invalid_tag",
  "too_many_tags",
  "note_too_long",
  "duplicate_in_input",
  "already_exists",
] as const;

export const mailboxImportItemSchema = z.object({
  /** 输入里的行号（从 1 开始） */
  line: z.number().int(),
  /** 该行原始地址列 */
  input: z.string(),
  /** 规范化后的地址（去空白、域名小写）；格式无效时为 null */
  address: z.string().nullable(),
  status: z.enum(MAILBOX_IMPORT_STATUSES),
  reason: z.enum(MAILBOX_IMPORT_REASONS).nullable(),
  /** 正式导入后新增或已存在的收件地址 id；预览与无效行为 null */
  id: z.number().int().nullable(),
});
export type MailboxImportItem = z.infer<typeof mailboxImportItemSchema>;

export const mailboxImportResponseSchema = z.object({
  dry_run: z.boolean(),
  summary: z.object({ new: z.number().int(), duplicate: z.number().int(), invalid: z.number().int() }),
  items: z.array(mailboxImportItemSchema),
});
export type MailboxImportResponse = z.infer<typeof mailboxImportResponseSchema>;

export const mailboxPatchSchema = z
  .object({
    label: nullableText(MAILBOX_LIMITS.labelMaxLength).optional(),
    note: nullableText(MAILBOX_LIMITS.noteMaxLength).optional(),
    status: mailboxStatusSchema.optional(),
    /** 整体替换标签 */
    tags: tagsSchema.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), { message: "至少要修改一个字段" });
export type MailboxPatch = z.input<typeof mailboxPatchSchema>;

export const MAILBOX_BATCH_ACTIONS = ["add_tags", "remove_tags", "enable", "disable", "delete"] as const;

export const mailboxBatchRequestSchema = z
  .object({
    ids: z.array(z.number().int().positive()).min(1).max(MAILBOX_LIMITS.batchMaxIds),
    action: z.enum(MAILBOX_BATCH_ACTIONS),
    tags: z.array(mailboxTagSchema).min(1).max(MAILBOX_LIMITS.tagsPerMailbox).optional(),
  })
  .refine((body) => !body.action.endsWith("_tags") || body.tags !== undefined, {
    message: "打标签 / 去标签需要提供 tags",
    path: ["tags"],
  });
export type MailboxBatchRequest = z.infer<typeof mailboxBatchRequestSchema>;

export const mailboxBatchResultSchema = z.object({
  id: z.number().int(),
  ok: z.boolean(),
  /** 失败原因：not_found 不存在；too_many_tags 标签超上限 */
  error: z.enum(["not_found", "too_many_tags"]).nullable(),
});
export const mailboxBatchResponseSchema = z.object({ results: z.array(mailboxBatchResultSchema) });
export type MailboxBatchResponse = z.infer<typeof mailboxBatchResponseSchema>;
