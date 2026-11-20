/** 服务端按统一错误体 `{ error: { code, message } }` 返回的业务错误 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** 错误体里 code / message 之外的字段（如规则组校验的 issues、删除冲突的 usage） */
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** fetch 本身失败：断网、DNS、被中止、CORS 等，没有拿到任何 HTTP 响应 */
export class NetworkError extends Error {
  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(`无法连接服务器（${path}）`, { cause });
    this.name = "NetworkError";
  }
}

/** 拿到了 2xx 响应，但响应体不符合 @maillink/shared 的 schema：前后端契约被破坏，必须暴露 */
export class ResponseFormatError extends Error {
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`响应格式与约定不符（${path}）：${detail}`);
    this.name = "ResponseFormatError";
  }
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}
