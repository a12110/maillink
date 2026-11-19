import { foldInvisibleAndCompat, LINK_HIDDEN_PLACEHOLDER, SNIPPET_MAX_CHARS } from "@maillink/shared";
import type { CompiledPresentation, CompiledRedaction } from "../rules/compile";
import { matchDomain, parseHttpUrl, urlHost } from "../rules/domains";

// 纯文本的呈现处理（02 §4.3、§4.4）：先处理链接，再按 redact 顺序脱敏；预览在处理完的全文上截取，
// 避免先截断把一个要脱敏的号码切成两半、漏掉匹配。

/**
 * 文本里的 URL：
 *   - 带协议（http / https / ftp）或 www. 开头的；
 *   - 没有协议、但带端口或路径的主机：域名（example.com/reset?t=1、evil.example:8080/x）
 *     或 IPv4（192.168.1.10/admin、10.0.0.1:8080/x）。前面不能是 @、字母数字或点，避免把邮箱地址的域名当成链接。
 * 不处理：既没有协议也没有端口、路径的裸域名或裸 IP（如 "evil.com"）。这类文字在纯文本视图里不可点击，
 * 前端必须约束为不对纯文本做自动链接化，由此兜底。
 */
const URL_IN_TEXT =
  /\b(?:(?:https?|ftp):\/\/|www\.)[^\s<>"'`]+|(?<![@\w.-])(?:(?:[a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5}(?:\/[^\s<>"'`]*)?|\/[^\s<>"'`]*)/giu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"。，；：！？）】》」]+$/u;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu;

/** 展示用归一化：与判定用同一套 NFKC 与去不可见字符（保证脱敏不会被全角、零宽绕过），但保留换行 */
export function normalizeDisplayText(value: string): string {
  return foldInvisibleAndCompat(value)
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/gu, " ").trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** links=keep 原样；strip 全部替换；allow_domains 只保留域名落在列表内的 http(s) 链接 */
export function processLinks(text: string, presentation: CompiledPresentation, knownLinks: readonly string[]): string {
  const links = presentation.config.links;
  if (links === "keep") return text;
  const allowDomains = presentation.allowDomains;
  const keep = (url: string): boolean => allowDomains !== null && isAllowedLink(url, allowDomains);
  const replaced = text.replace(URL_IN_TEXT, (whole) => {
    const core = whole.replace(TRAILING_PUNCTUATION, "");
    return keep(core) ? whole : LINK_HIDDEN_PLACEHOLDER + whole.slice(core.length);
  });
  // 兜底：解析阶段提取到、但上面的模式没认出来的链接，按原文逐个替换
  return [...knownLinks]
    .sort((a, b) => b.length - a.length)
    .reduce((acc, link) => (link !== "" && !keep(link) ? acc.split(link).join(LINK_HIDDEN_PLACEHOLDER) : acc), replaced);
}

function isAllowedLink(text: string, allowDomains: readonly string[]): boolean {
  const url = parseHttpUrl(HAS_SCHEME.test(text) ? text : `http://${text}`);
  return url !== null && matchDomain(urlHost(url), allowDomains) !== null;
}

export function applyRedactions(text: string, redactions: readonly CompiledRedaction[], target: "subject" | "body"): string {
  return redactions.reduce((acc, redaction) => {
    if (!redaction[target]) return acc;
    // 用函数替换：replace 里的 $1、$& 等按字面输出
    return acc.replace(redaction.regex, () => redaction.replace);
  }, text);
}

/** 链接处理 + 脱敏 */
export function processText(
  text: string,
  presentation: CompiledPresentation,
  knownLinks: readonly string[],
  target: "subject" | "body",
): string {
  return applyRedactions(processLinks(text, presentation, knownLinks), presentation.redactions, target);
}

export function makeSnippet(text: string): string {
  const chars = [...text];
  return chars.length <= SNIPPET_MAX_CHARS ? text : `${chars.slice(0, SNIPPET_MAX_CHARS).join("")}…`;
}
