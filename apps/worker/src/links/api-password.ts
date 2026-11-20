import type { Context } from "hono";
import { LINK_API_PASSWORD_BASE64_HEADER, LINK_API_PASSWORD_HEADER, LINK_PUBLIC_ERRORS, linkPasswordSchema } from "@maillink/shared";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { HTTP_BAD_REQUEST } from "../http-status";
import { parseWith } from "../validate";

// API 取码的口令请求头（PLAN"API 取码接口"，主 agent 在实测后裁定）：
//   - X-Link-Password：只接受 ASCII。HTTP 头值按字节传输，客户端与运行时对非 ASCII 字节的处理不一致
//     （实测 workerd 按 UTF-8 解码、坏字节替换成 U+FFFD；Python requests 按 latin1 编码，中文直接报错），
//     含非 ASCII 字符一律 400 link_password_encoding，不猜编码；
//   - X-Link-Password-Base64：口令 UTF-8 字节的标准 base64，非 ASCII 口令用它；
//   - 两个头同时出现 400（不替调用方选）。

const ASCII_MAX = 0x7f;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function encodingError(message: string): ApiError {
  return new ApiError(HTTP_BAD_REQUEST, LINK_PUBLIC_ERRORS.passwordEncoding, message);
}

function isAscii(text: string): boolean {
  return Array.from(text).every((char) => (char.codePointAt(0) ?? 0) <= ASCII_MAX);
}

function decodeBase64Utf8(value: string): string {
  const trimmed = value.trim();
  if (!BASE64.test(trimmed)) throw encodingError(`${LINK_API_PASSWORD_BASE64_HEADER} 不是合法的 base64`);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(atob(trimmed), (char) => char.charCodeAt(0)));
  } catch {
    throw encodingError(`${LINK_API_PASSWORD_BASE64_HEADER} 解码后不是合法的 UTF-8`);
  }
}

/** 取请求头里的口令；没给为 undefined。长度等规则与"开始取码"同一个 schema */
export function apiPasswordFromHeaders(c: Context<AppEnv>): string | undefined {
  const plain = c.req.header(LINK_API_PASSWORD_HEADER);
  const encoded = c.req.header(LINK_API_PASSWORD_BASE64_HEADER);
  if (plain !== undefined && encoded !== undefined) {
    throw encodingError(`${LINK_API_PASSWORD_HEADER} 与 ${LINK_API_PASSWORD_BASE64_HEADER} 只能给一个`);
  }
  if (plain !== undefined && !isAscii(plain)) {
    throw encodingError(`${LINK_API_PASSWORD_HEADER} 只接受 ASCII；口令含中文等字符时，请把 UTF-8 字节做 base64 后放进 ${LINK_API_PASSWORD_BASE64_HEADER}`);
  }
  const password = encoded === undefined ? plain : decodeBase64Utf8(encoded);
  return password === undefined ? undefined : parseWith(linkPasswordSchema, password);
}
