// HTML 属性里的 URL 判定。HTMLRewriter（lol-html）的 getAttribute 返回的是**未解码**的原文
// （`&#106;avascript:` 原样给出），所以必须先自己解码实体，再按浏览器的规则去掉空白与控制字符，最后按白名单判协议。
// 保留下来的 URL 一律用解码、规范化后的值重写属性，浏览器看到的就是我们判定过的那个值，不存在解码差异。

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  colon: ":",
  tab: "\t",
  newline: "\n",
  nbsp: "\u00A0",
  lpar: "(",
  rpar: ")",
  sol: "/",
  bsol: "\\",
  period: ".",
  comma: ",",
  excl: "!",
  num: "#",
  percnt: "%",
  semi: ";",
  equals: "=",
  quest: "?",
  commat: "@",
};

const ENTITY = /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);?/gu;
const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_MIN = 0xd800;
const SURROGATE_MAX = 0xdfff;
const HEX_RADIX = 16;
const DECIMAL_RADIX = 10;

function fromCodePoint(codePoint: number): string {
  const invalid =
    !Number.isFinite(codePoint) ||
    codePoint <= 0 ||
    codePoint > MAX_CODE_POINT ||
    (codePoint >= SURROGATE_MIN && codePoint <= SURROGATE_MAX);
  return invalid ? "\uFFFD" : String.fromCodePoint(codePoint);
}

/** 解码数字实体（含缺分号、前导零）与常用命名实体；不认识的命名实体原样保留（之后会因协议不在白名单而被拒绝） */
export function decodeHtmlEntities(value: string): string {
  return value.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return fromCodePoint(parseInt(body.slice(2), HEX_RADIX));
    if (body.startsWith("#")) return fromCodePoint(parseInt(body.slice(1), DECIMAL_RADIX));
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export type ClassifiedUrl =
  | { kind: "fragment"; href: string }
  | { kind: "data_image"; href: string }
  | { kind: "http"; url: URL }
  | { kind: "mailto"; url: URL }
  | { kind: "blocked" };

/**
 * 白名单判定：只认 `#片段`、`data:image/*`、http(s)、mailto。
 * 其余一律 blocked：javascript: / vbscript: / data:text/html / cid: / 相对路径（在 srcdoc 里没有意义）等。
 */
export function classifyUrl(raw: string): ClassifiedUrl {
  const cleaned = trimControlAndSpace(decodeHtmlEntities(raw).replace(/[\t\n\r]/gu, ""));
  if (cleaned.startsWith("#")) return { kind: "fragment", href: cleaned };
  if (/^data:image\//iu.test(cleaned)) return { kind: "data_image", href: cleaned };
  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return { kind: "blocked" };
  }
  if (url.protocol === "http:" || url.protocol === "https:") return { kind: "http", url };
  if (url.protocol === "mailto:") return { kind: "mailto", url };
  return { kind: "blocked" };
}

/** 码点 ≤ U+0020（C0 控制字符与空格） */
const MAX_TRIMMED_CODE = 0x20;

/** 浏览器解析 URL 前会去掉首尾的 C0 控制字符与空格（WHATWG URL） */
function trimControlAndSpace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= MAX_TRIMMED_CODE) start += 1;
  while (end > start && value.charCodeAt(end - 1) <= MAX_TRIMMED_CODE) end -= 1;
  return value.slice(start, end);
}

/** lol-html 的 setAttribute 只转义双引号；& 也要转义，否则浏览器可能把 URL 里的 `&xx;` 当实体解码 */
export function escapeAttributeValue(value: string): string {
  return value.replace(/&/gu, "&amp;");
}
