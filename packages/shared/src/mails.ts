import { z } from "zod";
import { LIST_PAGE_SIZE_MAX } from "./limits";

// 管理员"全部邮件"的请求与响应，见 docs/design/04-api.md。

/** 邮件分类，见 02 §3.6 */
export const MAIL_CATEGORIES = [
  "email_change",
  "password_reset",
  "security_change",
  "billing",
  "verification",
  "other",
] as const;
export const mailCategorySchema = z.enum(MAIL_CATEGORIES);

/** 验证码来源：temp_email 的 metadata.ai_extract，或本地内置提取 */
export const codeSourceSchema = z.enum(["ai_extract", "builtin"]);
export type CodeSource = z.infer<typeof codeSourceSchema>;

/** ok / failed 来自 mail_index；pending 表示本次请求没解析到（见 01 §4.2 的 partial） */
export const adminMailParseStatusSchema = z.enum(["ok", "failed", "pending"]);

export const MAIL_SCOPES = ["all", "imported", "unknown"] as const;
export const mailScopeSchema = z.enum(MAIL_SCOPES);
export type MailScope = z.infer<typeof mailScopeSchema>;

/** 过滤条件里地址与发件人文本的长度上限（RFC 5321 的邮箱长度上限） */
const FILTER_TEXT_MAX = 254;

const filterText = z.string().trim().min(1).max(FILTER_TEXT_MAX);
/** 9999-12-31 23:59:59 UTC：再大 formatD1Utc 会抛 RangeError，变成 500 */
const MAX_UNIX_SECONDS = 253_402_300_799;
const unixSeconds = z.coerce.number().int().nonnegative().max(MAX_UNIX_SECONDS);
/** 最多 15 位：落在 JS 安全整数范围内 */
const idString = z.string().regex(/^[1-9]\d{0,14}$/, "必须是正整数 id");

export const adminMailListQuerySchema = z
  .object({
    /** 信封收件人（raw_mails.address） */
    address: filterText.optional(),
    /** 邮件头收件人（raw_mails.to_address） */
    to_address: filterText.optional(),
    /** 信封发件人（raw_mails.source），不区分大小写 */
    source: filterText.optional(),
    /** 入库时间范围，Unix 秒，含边界 */
    since: unixSeconds.optional(),
    until: unixSeconds.optional(),
    scope: mailScopeSchema.default("all"),
    /** 翻页游标：上一页响应的 next_cursor */
    cursor: idString.optional(),
    /**
     * 增量轮询：只返回 id 更大的邮件。
     * 响应 `partial: true` 时调用方**不能**推进 after_id：pending 的邮件 id 可能比本页已就绪的更小，
     * 推进后它们在增量轮询里会永远漏掉。应稍后用同一个 after_id 重取，直到 partial 为 false。
     */
    after_id: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.coerce.number().int().min(1).max(LIST_PAGE_SIZE_MAX).optional(),
  })
  .refine((query) => !(query.cursor !== undefined && query.after_id !== undefined), {
    message: "cursor 与 after_id 不能同时使用",
  })
  .refine((query) => query.since === undefined || query.until === undefined || query.since <= query.until, {
    message: "since 不能晚于 until",
  });
export type AdminMailListQuery = z.infer<typeof adminMailListQuerySchema>;

export const adminMailListItemSchema = z.object({
  id: z.number().int(),
  received_at: z.number().int(),
  /** 收件地址（to_address，空则 address），全小写 */
  recipient: z.string(),
  /** 展示用发件人（From 头）；解析失败、未就绪或没有 From 时为 null */
  sender: z.object({ address: z.string().nullable(), name: z.string().nullable() }).nullable(),
  /** 信封发件人 */
  envelope: z.string().nullable(),
  parse_status: adminMailParseStatusSchema,
  /** 以下字段在 parse_status 不是 ok 时为 null */
  subject: z.string().nullable(),
  has_attachment: z.boolean().nullable(),
  code: z.string().nullable(),
  category: mailCategorySchema.nullable(),
});
export type AdminMailListItem = z.infer<typeof adminMailListItemSchema>;

export const adminMailListResponseSchema = z.object({
  items: z.array(adminMailListItemSchema),
  /** 翻页用；增量轮询（after_id）时恒为 null，调用方用本页最大的 id 作为下一次的 after_id */
  next_cursor: z.string().nullable(),
  /** true：本页有邮件还没解析完，调用方稍后重取同一请求；此时不能推进 after_id（见 adminMailListQuerySchema） */
  partial: z.boolean(),
});
export type AdminMailListResponse = z.infer<typeof adminMailListResponseSchema>;

export const mailAttachmentSchema = z.object({
  index: z.number().int(),
  name: z.string(),
  content_type: z.string(),
  size: z.number().int(),
});
export type MailAttachment = z.infer<typeof mailAttachmentSchema>;

export const adminMailDetailSchema = z.object({
  id: z.number().int(),
  received_at: z.number().int(),
  recipient: z.string(),
  /** MAIL_DB 里的信封信息 */
  envelope: z.object({
    source: z.string().nullable(),
    address: z.string().nullable(),
    to_address: z.string().nullable(),
  }),
  parse_status: z.enum(["ok", "failed"]),
  parse_error: z.string().nullable(),
  raw_size: z.number().int().nullable(),
  /** 以下为解析结果，parse_status 为 failed 时为 null */
  parsed: z
    .object({
      subject: z.string(),
      from: z.object({ address: z.string().nullable(), name: z.string().nullable() }),
      sender_candidates: z.object({ addresses: z.array(z.string()), domains: z.array(z.string()) }),
      /**
       * 展示用正文：NFKC、去不可见字符、每行内部合并空白、**保留换行**、连续空行最多一个。
       * 不是规则判定用的 MailFacts.body（那个是单行归一化文本，写进索引）。
       */
      body: z.string(),
      /** body 是否被截断（上限 ADMIN_DETAIL_BODY_CAP_BYTES） */
      body_truncated: z.boolean(),
      links: z.array(z.string()),
      attachments: z.array(mailAttachmentSchema),
      code: z.string().nullable(),
      code_source: codeSourceSchema.nullable(),
      category: mailCategorySchema,
      headers: z.array(z.object({ key: z.string(), value: z.string() })),
      has_html: z.boolean(),
    })
    .nullable(),
  /** 仅 ?raw=1 时返回；邮件原文 */
  raw: z.string().optional(),
});
export type AdminMailDetail = z.infer<typeof adminMailDetailSchema>;
