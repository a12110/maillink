import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE, errorResponseSchema } from "@maillink/shared";
import type { z } from "zod";
import { ApiError, NetworkError, ResponseFormatError } from "./errors";

export const HTTP_UNAUTHORIZED = 401;
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type RequestSpec<S extends z.ZodType> = {
  method?: HttpMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** 成功响应必须通过这个 schema，失败即抛 ResponseFormatError */
  schema: S;
  /** 默认 true：401 时调用 onUnauthorized（清会话缓存并跳登录）。登录与“查会话”自己处理 401，传 false */
  handleUnauthorized?: boolean;
};

export type ApiClientOptions = {
  fetchImpl: typeof fetch;
  onUnauthorized: () => void;
};

export type ApiClient = {
  request<S extends z.ZodType>(spec: RequestSpec<S>): Promise<z.output<S>>;
};

function buildUrl(path: string, query: RequestSpec<z.ZodType>["query"]): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const search = params.toString();
  return search === "" ? path : `${path}?${search}`;
}

/** 写请求自动带 CSRF 头；同源 Cookie 由 credentials 控制 */
function buildInit(method: HttpMethod, body: unknown): RequestInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (!SAFE_METHODS.has(method)) headers[CSRF_HEADER_NAME] = CSRF_HEADER_VALUE;
  const init: RequestInit = { method, headers, credentials: "same-origin" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return init;
}

async function readJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await response.json() };
  } catch {
    return { ok: false };
  }
}

/** 统一错误体里 code / message 之外的字段（errorResponseSchema 会把它们剥掉） */
function extraErrorFields(body: unknown): Record<string, unknown> {
  const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null;
  if (typeof error !== "object" || error === null) return {};
  const { code: _code, message: _message, ...rest } = error as Record<string, unknown>;
  return rest;
}

/** 错误响应：能解析统一错误体就用它的 code / message，否则明确标成 unexpected_response（如反向代理的 HTML 502） */
async function toApiError(response: Response): Promise<ApiError> {
  const json = await readJson(response);
  const parsed = json.ok ? errorResponseSchema.safeParse(json.value) : null;
  if (parsed?.success) {
    const { code, message } = parsed.data.error;
    return new ApiError(response.status, code, message, extraErrorFields(json.ok ? json.value : null));
  }
  return new ApiError(response.status, "unexpected_response", "服务器返回了无法识别的响应（不是约定的 JSON 错误体）");
}

async function parseSuccess<S extends z.ZodType>(response: Response, spec: RequestSpec<S>): Promise<z.output<S>> {
  const json = await readJson(response);
  if (!json.ok) throw new ResponseFormatError(spec.path, "响应体不是合法的 JSON");
  const parsed = spec.schema.safeParse(json.value);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "(根)"}: ${i.message}`).join("; ");
    throw new ResponseFormatError(spec.path, detail);
  }
  return parsed.data;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  async function request<S extends z.ZodType>(spec: RequestSpec<S>): Promise<z.output<S>> {
    const url = buildUrl(spec.path, spec.query);
    let response: Response;
    try {
      response = await options.fetchImpl(url, buildInit(spec.method ?? "GET", spec.body));
    } catch (cause) {
      throw new NetworkError(spec.path, cause);
    }
    if (!response.ok) {
      const error = await toApiError(response);
      if (response.status === HTTP_UNAUTHORIZED && spec.handleUnauthorized !== false) options.onUnauthorized();
      throw error;
    }
    return parseSuccess(response, spec);
  }
  return { request };
}
