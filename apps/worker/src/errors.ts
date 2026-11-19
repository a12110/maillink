import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HTTP_NOT_FOUND } from "./http-status";

/** 业务层可预期的错误，由全局处理器转成 `{ error: { code, message } }` */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function notFoundError(message = "资源不存在"): ApiError {
  return new ApiError(HTTP_NOT_FOUND, "not_found", message);
}
