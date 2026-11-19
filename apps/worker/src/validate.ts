import type { Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "./env";
import { ApiError } from "./errors";
import { HTTP_BAD_REQUEST } from "./http-status";

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}

/**
 * 路由边界的统一校验：失败抛 400 `validation_error`。
 * 只有经过这里的 ZodError 才会变成 400；其他位置冒出的 ZodError 是代码缺陷，走 500。
 */
export function parseWith<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(HTTP_BAD_REQUEST, "validation_error", formatIssues(result.error));
  }
  return result.data;
}

export async function parseJsonBody<S extends z.ZodType>(
  c: Context<AppEnv>,
  schema: S,
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(HTTP_BAD_REQUEST, "invalid_json", "请求体不是合法的 JSON");
  }
  return parseWith(schema, raw);
}

export function parseQuery<S extends z.ZodType>(c: Context<AppEnv>, schema: S): z.output<S> {
  return parseWith(schema, c.req.query());
}

const idSchema = z.coerce.number().int().positive();

/** 路径里的数字 id，默认参数名 `id` */
export function parseIdParam(c: Context<AppEnv>, name = "id"): number {
  return parseWith(idSchema, c.req.param(name));
}
