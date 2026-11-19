import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiError } from "../errors";
import type { AppEnv } from "../env";
import { HTTP_INTERNAL_ERROR, HTTP_NOT_FOUND } from "../http-status";

/** 统一错误体，见 docs/design/04-api.md 约定 */
function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof ApiError) {
    return c.json(errorBody(err.code, err.message), err.status);
  }
  if (err instanceof HTTPException) {
    return c.json(errorBody("http_error", err.message), err.status);
  }
  // 未预期的异常（包括路由边界之外冒出的 ZodError）：记录完整错误，对外只给通用信息，不吞。
  // 请求参数校验失败由 validate.ts 在路由边界转成 400 ApiError，不会走到这里。
  console.error("unhandled error", err);
  return c.json(errorBody("internal_error", "服务器内部错误"), HTTP_INTERNAL_ERROR);
};

export const notFound: NotFoundHandler<AppEnv> = (c) =>
  c.json(errorBody("not_found", "资源不存在"), HTTP_NOT_FOUND);
