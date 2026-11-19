import { z } from "zod";

/** 所有写操作（POST/PUT/PATCH/DELETE）必须带的 CSRF 请求头，值固定为 CSRF_HEADER_VALUE */
export const CSRF_HEADER_NAME = "X-MailLink-Csrf";
export const CSRF_HEADER_VALUE = "1";

/** 统一错误体，见 docs/design/04-api.md 约定 */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** 没有自然返回体的写操作 */
export const okResponseSchema = z.object({ status: z.literal("ok") });
export type OkResponse = z.infer<typeof okResponseSchema>;

/** 列表统一结构：`{ items, next_cursor }` */
export function listResponseSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
  });
}
