import { z } from "zod";
import { turnstileTokenSchema } from "./auth";
import { VIEW_MODES } from "./rule-group";
import { presentedMailSchema } from "./rule-group-presented-mail";
import { LINK_REVEAL_MODES, linkPasswordSchema } from "./share-link-access";

// 公开取件接口 /api/s/:token/*（04 取件链接公开页，02 §6，05 §3 取件页状态表）。

/**
 * 对外错误码。02 §6"对外只分三种" + PLAN 裁定的两种单独状态：
 *   - link_not_found（404）：token 不存在；
 *   - link_unavailable（410）：撤销 / 暂停 / 过期 / 总次数用尽 / IP 或国家不在白名单，统一文案，不透露原因；
 *   - link_not_yet_valid（403）：未到生效时间，带 valid_from；
 *   - link_device_limit（403）：设备数已满，带 public_note；
 *   - link_daily_limit（429）：每日取码上限用尽，带 retry_after_at（窗口内最早一次取码 + 24 小时）。
 * 其余为流程类：需要先"开始取码"、口令错误 / 锁定、无可用邮箱、限流。
 */
export const LINK_PUBLIC_ERRORS = {
  notFound: "link_not_found",
  unavailable: "link_unavailable",
  notYetValid: "link_not_yet_valid",
  deviceLimit: "link_device_limit",
  dailyLimit: "link_daily_limit",
  startRequired: "link_start_required",
  passwordRequired: "link_password_required",
  passwordInvalid: "link_password_invalid",
  passwordLocked: "link_password_locked",
  noMailbox: "link_no_mailbox",
  revealNotApplicable: "link_reveal_not_applicable",
  turnstileNotConfigured: "turnstile_not_configured",
} as const;

/**
 * 取件页状态（链接本身有效时）：
 *   - needs_start：新访客，显示标题、说明与"开始取码"（requires_password 时同一步输入口令）；
 *   - active：已登记的访客，可以拉邮件列表；
 *   - device_limit：新访客但设备数已满（显示 public_note）；
 *   - daily_limit：已登记访客，今日取码次数用尽（retry_after_at）；
 *   - no_mailbox：链接下没有可用的收件地址。
 */
export const LINK_PAGE_STATES = ["needs_start", "active", "device_limit", "daily_limit", "no_mailbox"] as const;
export type LinkPageState = (typeof LINK_PAGE_STATES)[number];

export const linkDeliveryQuotaSchema = z.object({
  total_limit: z.number().int().nullable(),
  total_used: z.number().int(),
  total_remaining: z.number().int().nullable(),
  daily_limit: z.number().int().nullable(),
  /** 滚动 24 小时内 */
  daily_used: z.number().int(),
  daily_remaining: z.number().int().nullable(),
  /** 每日次数用尽时大约何时恢复（窗口内最早一次取码 + 24 小时）；未用尽为 null */
  daily_resets_at: z.number().int().nullable(),
});
export type LinkDeliveryQuota = z.infer<typeof linkDeliveryQuotaSchema>;

/** 取件页的人机验证：只看链接自己的开关；site_key 只在 required 且系统已配置站点密钥时给 */
export const linkTurnstileSchema = z.object({
  required: z.boolean(),
  site_key: z.string().optional(),
});

/**
 * 取件页要显示的站点设置：show_brand=false 时不给 name / logo；
 * logo 只给 data:image/ 形式（取件页不加载第三方资源，https Logo 不返回）；notice 为空不给。
 */
export const linkSiteSchema = z.object({
  show_brand: z.boolean(),
  name: z.string().optional(),
  logo: z.string().optional(),
  notice: z.string().optional(),
});

export const linkPublicStatusSchema = z.object({
  state: z.enum(LINK_PAGE_STATES),
  /** 链接是否已被首次"开始取码"（任何访客） */
  activated: z.boolean(),
  /** 当前浏览器是否已登记为设备 */
  visitor_registered: z.boolean(),
  requires_password: z.boolean(),
  requires_turnstile: z.boolean(),
  turnstile: linkTurnstileSchema,
  site: linkSiteSchema,
  view: z.enum(VIEW_MODES),
  reveal: z.enum(LINK_REVEAL_MODES),
  /** 设了取码次数上限时给出；否则为 null */
  deliveries: linkDeliveryQuotaSchema.nullable(),
  poll_interval_sec: z.number().int(),
  /** 收件地址按规则组 recipient 处理：full 原样、masked 打码、hidden 为空数组 */
  mailboxes: z.array(z.string()),
  mailbox_count: z.number().int(),
  recipient_display: z.enum(["full", "masked", "hidden"]),
  /** 当前生效的失效时间（绝对过期与首次访问后过期取较早者）；没有为 null */
  expires_at: z.number().int().nullable(),
  /** 尚未激活时：首次"开始取码"后多少秒失效 */
  expire_after_first_access_sec: z.number().int().nullable(),
  public_title: z.string().nullable(),
  public_note: z.string().nullable(),
  /** state=daily_limit 时同 deliveries.daily_resets_at */
  retry_after_at: z.number().int().nullable(),
  /** state=device_limit 时给出设备数上限（"最多 N 台，名额已满"）；其他状态为 null，不对外多透露 */
  max_devices: z.number().int().nullable(),
});
export type LinkPublicStatus = z.infer<typeof linkPublicStatusSchema>;

export const linkStartRequestSchema = z.strictObject({
  password: linkPasswordSchema.optional(),
  /** 链接开启人机验证（status.turnstile.required）时必填；已登记设备再点"开始取码"不校验 */
  turnstile_token: turnstileTokenSchema.optional(),
});
export type LinkStartRequest = z.infer<typeof linkStartRequestSchema>;

export const linkRevealResponseSchema = z.object({
  mail: presentedMailSchema,
  /** 本次是否新计了一次（同一封重复显示不计） */
  counted: z.boolean(),
  deliveries: linkDeliveryQuotaSchema.nullable(),
});
export type LinkRevealResponse = z.infer<typeof linkRevealResponseSchema>;

export const linkMailListQuerySchema = z
  .object({
    /** 上一页响应的 next_cursor */
    cursor: z.string().regex(/^[1-9]\d{0,14}$/u, "cursor 无效").optional(),
    /** 增量轮询：用上次响应的 next_after_id；partial=true 时不要推进 */
    after_id: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .refine((query) => !(query.cursor !== undefined && query.after_id !== undefined), { message: "cursor 与 after_id 不能同时使用" });
export type LinkMailListQuery = z.infer<typeof linkMailListQuerySchema>;
