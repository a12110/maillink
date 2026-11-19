/** 把孤立的代理项（半个 emoji）换成 U+FFFD，保证 encodeURIComponent 等不会抛 URIError */
export function toWellFormedString(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

/** 按码点截断（不会切开 emoji 的代理对），结果保证是合法字符串 */
export function truncateChars(text: string, maxChars: number): string {
  return toWellFormedString(Array.from(text).slice(0, maxChars).join(""));
}
