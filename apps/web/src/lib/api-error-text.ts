import { ApiError } from "../api/errors";
import { describeError } from "./messages";

/** 错误码 → 中文说明。值是函数时可拼上服务端 message（其中带数量、字段名等动态信息） */
export type ErrorTexts = Readonly<Record<string, string | ((serverMessage: string) => string)>>;

/**
 * 在 describeError 之上叠加一张按错误码的中文说明表（每个功能自己的表）；表里没有的码仍用服务端 message。
 * detail 始终带错误码与 HTTP 状态，不吞原因。
 */
export function describeErrorWith(texts: ErrorTexts, error: unknown): { message: string; detail: string } {
  const base = describeError(error);
  if (!(error instanceof ApiError)) return base;
  const text = texts[error.code];
  if (text === undefined) return base;
  return { message: typeof text === "function" ? text(error.message) : text, detail: base.detail };
}
