import {
  CSRF_HEADER_NAME,
  CSRF_HEADER_VALUE,
  linkPublicStatusSchema,
  linkRevealResponseSchema,
  presentedMailSchema,
  visibleMailListResponseSchema,
} from "@maillink/shared";
import type { LinkStartRequest } from "@maillink/shared";
import { z } from "zod";
import { NetworkError, ResponseFormatError } from "../../api/errors";

// 取件页公开接口 /api/s/:token/*。
// 不复用 api/client：① 公开接口的 401（link_start_required）不是"会话过期"，绝不能触发跳登录；
// ② 错误体里带业务字段（valid_from / public_note / retry_after_at），统一客户端会丢掉它们。

export class PickupError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** 错误体里 code / message 之外的字段（valid_from、public_note、retry_after_at 等） */
    readonly extra: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "PickupError";
  }
}

const errorBodySchema = z.object({ error: z.looseObject({ code: z.string(), message: z.string() }) });

type Spec<S extends z.ZodType> = {
  method?: "GET" | "POST";
  token: string;
  suffix?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  schema: S;
};

function buildUrl(token: string, suffix: string, query: Spec<z.ZodType>["query"]): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  const path = `/api/s/${encodeURIComponent(token)}${suffix}`;
  return search === "" ? path : `${path}?${search}`;
}

async function readJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await response.json() };
  } catch {
    return { ok: false };
  }
}

async function toPickupError(response: Response): Promise<PickupError> {
  const json = await readJson(response);
  const parsed = json.ok ? errorBodySchema.safeParse(json.value) : null;
  if (parsed?.success) {
    const { code, message, ...extra } = parsed.data.error;
    return new PickupError(response.status, code, message, extra);
  }
  return new PickupError(response.status, "unexpected_response", "服务器返回了无法识别的响应", {});
}

async function pickupRequest<S extends z.ZodType>(spec: Spec<S>): Promise<z.output<S>> {
  const path = `/api/s/…${spec.suffix ?? ""}`;
  const method = spec.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = { method, headers, credentials: "same-origin", cache: "no-store" };
  if (method !== "GET") headers[CSRF_HEADER_NAME] = CSRF_HEADER_VALUE;
  if (spec.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(spec.body);
  }
  let response: Response;
  try {
    response = await fetch(buildUrl(spec.token, spec.suffix ?? "", spec.query), init);
  } catch (cause) {
    // 错误里的路径不含 token（token 不进日志与报错）
    throw new NetworkError(path, cause);
  }
  if (!response.ok) throw await toPickupError(response);
  const json = await readJson(response);
  if (!json.ok) throw new ResponseFormatError(path, "响应体不是合法的 JSON");
  const parsed = spec.schema.safeParse(json.value);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(根)"}: ${issue.message}`).join("; ");
    throw new ResponseFormatError(path, detail);
  }
  return parsed.data;
}

export type MailsQuery = { cursor?: string; after_id?: number };

export const pickupApi = {
  status: (token: string) => pickupRequest({ token, schema: linkPublicStatusSchema }),
  start: (token: string, body: LinkStartRequest) =>
    pickupRequest({ method: "POST", token, suffix: "/start", body, schema: linkPublicStatusSchema }),
  mails: (token: string, query: MailsQuery) =>
    pickupRequest({ token, suffix: "/mails", query, schema: visibleMailListResponseSchema }),
  reveal: (token: string, id: number) =>
    pickupRequest({ method: "POST", token, suffix: `/mails/${id}/reveal`, schema: linkRevealResponseSchema }),
  detail: (token: string, id: number) => pickupRequest({ token, suffix: `/mails/${id}`, schema: presentedMailSchema }),
};

export type PickupApi = typeof pickupApi;

export function pickupAttachmentHref(token: string, mailId: number, index: number): string {
  return `/api/s/${encodeURIComponent(token)}/mails/${mailId}/attachments/${index}`;
}
