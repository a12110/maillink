import { z } from "zod";

/** 一次定时任务运行的记录（存在 settings 里，health 展示） */
export const cronRunSchema = z.object({
  /** Unix 秒 */
  started_at: z.number().int(),
  finished_at: z.number().int(),
  ok: z.boolean(),
  /** 各项处理数量，键由任务定义 */
  processed: z.record(z.string(), z.number().int()),
  /** 失败原因；成功为 null */
  error: z.string().nullable(),
});
export type CronRun = z.infer<typeof cronRunSchema>;

/** 每个任务最近一次运行；从未运行过为 null */
export const cronStatusSchema = z.object({
  prewarm: cronRunSchema.nullable(),
  cleanup: cronRunSchema.nullable(),
});
export type CronStatus = z.infer<typeof cronStatusSchema>;

export const rateLimitStatusSchema = z.object({
  /** RATE_LIMITER 绑定是否存在；false 时登录等受保护接口返回 503 rate_limiter_not_configured */
  configured: z.boolean(),
});
export type RateLimitStatus = z.infer<typeof rateLimitStatusSchema>;
