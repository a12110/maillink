// 呈现：视图模式、字段可见性、链接与脱敏、HTML 清洗。见 docs/design/02-rule-engine.md §4。
export { lockPresentedMail, presentDetail, presentListItem, presentParties, viewHasDetail, type DetailContent } from "./present";
export { maskAddress } from "./mask";
export { applyRedactions, makeSnippet, normalizeDisplayText, processLinks, processText } from "./text";
export { HtmlSanitizeError, sanitizeEmailHtml, type HtmlSanitizeOptions } from "./html-sanitize";
export { stripUnfinishedTail } from "./html-tail";
export { classifyUrl, decodeHtmlEntities } from "./html-url";
export { sanitizeCss } from "./html-css";
