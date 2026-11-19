import { toWellFormedString, truncateChars } from "../text-utils";

const ASCII_FILENAME_UNSAFE = /[^\x20-\x7e]|["\\%;/]/g;
const FILENAME_MAX_LENGTH = 200;

/** RFC 5987 的 attr-char 之外还要转义 ' ( ) *，encodeURIComponent 不处理它们 */
function percentEncode(text: string): string {
  return encodeURIComponent(text).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * 附件下载的 Content-Disposition：一律 attachment；
 * 同时给 ASCII 兜底的 filename 与 RFC 5987 的 filename*（UTF-8 百分号编码），避免换行、引号等注入头部。
 */
export function attachmentDisposition(name: string, fallbackName: string): string {
  // 按码点截断：UTF-16 下 slice 可能切开 emoji，让 encodeURIComponent 抛 URIError
  const safeName = truncateChars(toWellFormedString(name).trim() || fallbackName, FILENAME_MAX_LENGTH);
  const ascii = safeName.replace(ASCII_FILENAME_UNSAFE, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${percentEncode(safeName)}`;
}
