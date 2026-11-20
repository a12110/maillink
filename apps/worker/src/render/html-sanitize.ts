import type { LinksConfig } from "@maillink/shared";
import { matchDomain, urlHost } from "../rules/domains";
import { isAllowedAttribute, URL_ATTRIBUTES } from "./html-attributes";
import { sanitizeCss } from "./html-css";
import { stripUnfinishedTail } from "./html-tail";
import { classifyUrl, decodeHtmlEntities, escapeAttributeValue, type ClassifiedUrl } from "./html-url";

// view = full 的 HTML 清洗（02 §4.5 第 1 条），用 Workers 自带的 HTMLRewriter（lol-html，流式、无 DOM）。
// 这是三层防护的第一层；第二层是前端无 allow-scripts / allow-same-origin 的 sandbox iframe，第三层是 srcdoc 内的 CSP。
//
// 规则：
//   - 整个删除（连同内容）：script / iframe / frame / frameset / object / embed / applet / param / form 及表单控件 /
//     link / meta / base / svg / math / noscript / template / audio / video / portal /
//     title / xmp / noembed / noframes / plaintext（RCDATA 与原始文本元素，末尾截断逻辑不认它们的上下文）。
//     svg 与 math 会切换解析命名空间，是 mXSS 的常见入口；noscript 在 lol-html 里按原始文本处理，但无脚本的 sandbox
//     iframe 会把它当普通标记渲染（解析差异，已用实测确认），所以一律删除。
//   - 属性按白名单保留（html-attributes.ts），其余一律删除（含 on*、ping、attributionsrc、formaction 等）；
//     同名属性出现多次时整个删除（lol-html 的 setAttribute 只改第一份，不赌浏览器取哪一份）。
//   - a / area 的 href：解码实体后按白名单判协议（见 html-url.ts），再按 links 配置决定保留与否；保留的重写为规范化 URL。
//     指向外部（http / mailto）的链接加 rel="noopener noreferrer"、target="_blank"；#片段链接不加。
//   - img 的 src、表格与 body 的 background：data:image/* 保留；remote_images=allow 时 https 保留；其余删除。
//     img / source 的 srcset：block 时删除；allow 时每一项都必须是 https，否则整条删除。
//   - style 属性与 <style> 元素按 html-css.ts 的策略处理。
//   - HTML 注释删除（含条件注释）。
//   - 输出末尾未完成的标签 / 注释截掉（html-tail.ts）。
//   - lol-html 遇到无法流式判定的标记（如 <select><style>）会抛错：包装成 HtmlSanitizeError 抛出，
//     调用方应降级为只返回纯文本并记日志，绝不能回退到原始 HTML。

export type HtmlSanitizeOptions = {
  links: LinksConfig;
  /** links = { allow_domains } 时的编译结果（compileDomainList） */
  allowDomains: readonly string[] | null;
  remoteImages: "block" | "allow";
};

const REMOVED_ELEMENTS: ReadonlySet<string> = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "param",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "link",
  "meta",
  "base",
  "svg",
  "math",
  "noscript",
  "template",
  "audio",
  "video",
  "portal",
  // RCDATA / 原始文本元素：stripUnfinishedTail 不认它们的解析上下文，整段删除（纵深防御）
  "title",
  "xmp",
  "noembed",
  "noframes",
  "plaintext",
]);

const LINK_ELEMENTS: ReadonlySet<string> = new Set(["a", "area"]);

/** 清洗失败（lol-html 解析器放弃）；调用方据此只返回纯文本，不得回退到原始 HTML */
export class HtmlSanitizeError extends Error {
  constructor(cause: unknown) {
    super(`HTML 清洗失败：${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "HtmlSanitizeError";
  }
}

export async function sanitizeEmailHtml(html: string, options: HtmlSanitizeOptions): Promise<string> {
  const rewriter = new HTMLRewriter()
    .on("*", { element: (element) => sanitizeElement(element, options) })
    .on("style", styleElementHandler(options.remoteImages))
    .onDocument({ comments: (comment) => void comment.remove() });
  const response = new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  let output: string;
  try {
    output = await rewriter.transform(response).text();
  } catch (error) {
    throw new HtmlSanitizeError(error);
  }
  return stripUnfinishedTail(output);
}

function sanitizeElement(element: Element, options: HtmlSanitizeOptions): void {
  const tag = element.tagName.toLowerCase();
  if (REMOVED_ELEMENTS.has(tag)) {
    element.remove();
    return;
  }
  sanitizeAttributes(element, tag, options);
  markExternalLink(element, tag);
}

function sanitizeAttributes(element: Element, tag: string, options: HtmlSanitizeOptions): void {
  const attributes = [...element.attributes].map(([name = "", value = ""]) => [name.toLowerCase(), value] as const);
  const counts = new Map<string, number>();
  for (const [name] of attributes) counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const [name, value] of attributes) {
    if (counts.get(name) !== 1 || !isAllowedAttribute(tag, name)) element.removeAttribute(name);
    else if (name === "style") sanitizeStyleAttribute(element, name, value, options.remoteImages);
    else if (URL_ATTRIBUTES.has(name)) sanitizeUrlAttribute(element, name, value, options);
  }
}

/** 指向外部的链接在新窗口打开且不带 referrer；#片段链接留在本页 */
function markExternalLink(element: Element, tag: string): void {
  const href = LINK_ELEMENTS.has(tag) ? element.getAttribute("href") : null;
  if (href !== null && !href.startsWith("#")) {
    element.setAttribute("rel", "noopener noreferrer");
    element.setAttribute("target", "_blank");
  }
}

function sanitizeStyleAttribute(element: Element, name: string, value: string, remoteImages: "block" | "allow"): void {
  // 属性值在交给 CSS 解析前会被浏览器解码实体，所以先解码再判定
  const css = sanitizeCss(decodeHtmlEntities(value), remoteImages);
  if (css === null) element.removeAttribute(name);
  else element.setAttribute(name, escapeAttributeValue(css));
}

/** 白名单已保证：href 只在 a / area，src 只在 img，srcset 只在 img / source，background 只在表格与 body */
function sanitizeUrlAttribute(element: Element, name: string, value: string, options: HtmlSanitizeOptions): void {
  let result: string | null;
  if (name === "href") result = linkHref(classifyUrl(value), options);
  else if (name === "srcset") result = srcset(value, options.remoteImages);
  else result = imageSource(classifyUrl(value), options.remoteImages);
  if (result === null) element.removeAttribute(name);
  else element.setAttribute(name, escapeAttributeValue(result));
}

function linkHref(target: ClassifiedUrl, options: HtmlSanitizeOptions): string | null {
  if (options.links === "strip") return null;
  if (target.kind === "fragment") return target.href;
  if (target.kind === "mailto") return options.links === "keep" ? target.url.href : null;
  if (target.kind !== "http") return null;
  if (options.links === "keep") return target.url.href;
  const allowed = options.allowDomains !== null && matchDomain(urlHost(target.url), options.allowDomains) !== null;
  return allowed ? target.url.href : null;
}

function imageSource(target: ClassifiedUrl, remoteImages: "block" | "allow"): string | null {
  if (target.kind === "data_image") return target.href;
  const remoteAllowed = remoteImages === "allow" && target.kind === "http" && target.url.protocol === "https:";
  return remoteAllowed ? target.url.href : null;
}

function srcset(value: string, remoteImages: "block" | "allow"): string | null {
  if (remoteImages === "block") return null;
  const rebuilt: string[] = [];
  for (const candidate of decodeHtmlEntities(value).split(",")) {
    const [url = "", ...descriptor] = candidate.trim().split(/\s+/u);
    const target = classifyUrl(url);
    if (target.kind !== "http" || target.url.protocol !== "https:") return null;
    rebuilt.push([target.url.href, ...descriptor].join(" "));
  }
  return rebuilt.join(", ");
}

/** <style> 的内容可能分多个文本块到达：先全部攒下（并从输出中移除），最后一块时整体判定后写回或丢弃 */
function styleElementHandler(remoteImages: "block" | "allow"): HTMLRewriterElementContentHandlers {
  let buffer = "";
  return {
    element: () => {
      buffer = "";
    },
    text: (chunk) => {
      buffer += chunk.text;
      if (!chunk.lastInTextNode) {
        chunk.remove();
        return;
      }
      const css = sanitizeCss(buffer, remoteImages);
      buffer = "";
      if (css === null) chunk.remove();
      // sanitizeCss 已拒绝含 < 的内容，按原始文本写回不可能跳出 <style>
      else chunk.replace(css, { html: true });
    },
  };
}
