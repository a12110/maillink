import { z } from "zod";
import { presentedMailSchema } from "./rule-group-presented-mail";

// API 取码：GET /api/s/:token/code（PLAN"API 取码接口"，对 04 取件链接公开接口的补充），文档见 docs/api-code.md。

export const LINK_API_CODE_LIMITS = {
  limitMin: 1,
  limitMax: 10,
  limitDefault: 1,
} as const;

/**
 * 有副作用的取码必须带这个头（值为 "1"）：接口地址被贴进聊天软件时，预览机器人只会发不带自定义头的 GET，
 * 缺头时 400 且不做任何事，不会占设备、开始首次访问倒计时或消耗次数。
 */
export const LINK_API_REQUIRED_HEADER = "X-MailLink-Api";
export const LINK_API_REQUIRED_HEADER_VALUE = "1";

/** 口令走请求头（不进 URL，避免出现在访问日志与代理记录里）；这个头只接受 ASCII */
export const LINK_API_PASSWORD_HEADER = "X-Link-Password";
/** 非 ASCII 口令：UTF-8 字节的标准 base64；与 X-Link-Password 只能给一个 */
export const LINK_API_PASSWORD_BASE64_HEADER = "X-Link-Password-Base64";

/** 链接侧板与文档里展示的接口路径：`/api/s/<token>/code` */
export function linkApiCodePath(token: string): string {
  return `/api/s/${token}/code`;
}

export const linkApiCodeQuerySchema = z.object({
  /** 只看这个时间（Unix 秒）及之后收到的邮件 */
  since: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  /** 最多返回几封（按收到时间从新到旧） */
  limit: z.coerce.number().int().min(LINK_API_CODE_LIMITS.limitMin).max(LINK_API_CODE_LIMITS.limitMax).default(LINK_API_CODE_LIMITS.limitDefault),
});
export type LinkApiCodeQuery = z.infer<typeof linkApiCodeQuerySchema>;

/**
 * - ok：取到验证码；
 * - no_code：可见邮件里没有验证码（或 reason=view_meta_only：规则组只给元信息，永远不返回验证码）；
 * - pending：有邮件还没解析完、且还没找到验证码，按 retry_after_sec 重试。
 */
export const LINK_API_CODE_STATUSES = ["ok", "no_code", "pending"] as const;
export type LinkApiCodeStatus = (typeof LINK_API_CODE_STATUSES)[number];

export const LINK_API_CODE_REASONS = ["view_meta_only"] as const;

export const linkApiCodeItemSchema = z.strictObject({
  code: z.string(),
  received_at: z.number().int(),
  received_at_iso: z.string(),
  mail_id: z.number().int(),
});
export type LinkApiCodeItem = z.infer<typeof linkApiCodeItemSchema>;

export const linkApiCodeResponseSchema = z.strictObject({
  status: z.enum(LINK_API_CODE_STATUSES),
  /** 以下五项是 items[0]（最新一封）的；没有时为 null */
  code: z.string().nullable(),
  received_at: z.number().int().nullable(),
  received_at_iso: z.string().nullable(),
  mail_id: z.number().int().nullable(),
  /** 按规则组 present.sender 处理；hidden 或没有时为 null */
  sender: presentedMailSchema.shape.sender.unwrap().nullable(),
  /** 收件地址，按规则组 present.recipient 处理（masked 打码）；hidden 时为 null */
  mailbox: z.string().nullable(),
  /** 扫描中遇到还没解析完的邮件 */
  partial: z.boolean(),
  /** 建议多少秒后再请求；ok 与 view_meta_only 为 null */
  retry_after_sec: z.number().int().nullable(),
  /** 设了取码次数上限（click）时的剩余次数；不限的一项为 null；没有任何上限时整体为 null */
  remaining: z.strictObject({ total: z.number().int().nullable(), today: z.number().int().nullable() }).nullable(),
  /** 从新到旧 */
  items: z.array(linkApiCodeItemSchema),
  reason: z.enum(LINK_API_CODE_REASONS).optional(),
});
export type LinkApiCodeResponse = z.infer<typeof linkApiCodeResponseSchema>;
