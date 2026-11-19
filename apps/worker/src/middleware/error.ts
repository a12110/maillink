import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { ApiError } from "../errors";
import type { AppEnv } from "../env";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_ERROR = 500;

/** 统一错误体，见 docs/design/04-api.md 约定 */
function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof ApiError) {
    return c.json(errorBody(err.code, err.message), err.status);
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((issue) => issue.message).join("; ");
    return c.json(errorBody("validation_error", message), HTTP_BAD_REQUEST);
  }
  if (err instanceof HTTPException) {
    return c.json(errorBody("http_error", err.message), err.status);
  }
  // 未预期的异常：记录完整错误，对外只给通用信息，不吞
  console.error("unhandled error", err);
  return c.json(errorBody("internal_error", "服务器内部错误"), HTTP_INTERNAL_ERROR);
};

export const notFound: NotFoundHandler<AppEnv> = (c) =>
  c.json(errorBody("not_found", "资源不存在"), HTTP_NOT_FOUND);
