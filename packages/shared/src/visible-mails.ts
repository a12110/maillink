import { z } from "zod";
import { presentedMailSchema } from "./rule-group-presented-mail";

// 按规则组裁剪后的邮件列表（取件链接、用户收件箱共用，见 04 PresentedMail 与 01 §4.2 的 partial）。

export const visibleMailListResponseSchema = z.object({
  /** 新的在前 */
  items: z.array(presentedMailSchema),
  next_cursor: z.string().nullable(),
  /** 有邮件本次没解析到：前端短延时后用同样的参数重取 */
  partial: z.boolean(),
  /**
   * 下次增量轮询可以安全使用的 after_id。
   * partial 为 true 时它不会越过任何未就绪的邮件；没有可推进的位置时为请求里的 after_id（首页时为 null）。
   */
  next_after_id: z.number().int().nullable(),
});
export type VisibleMailListResponse = z.infer<typeof visibleMailListResponseSchema>;
