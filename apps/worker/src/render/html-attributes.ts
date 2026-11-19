// 邮件 HTML 的属性白名单：只保留排版需要的属性，其余（on*、ping、attributionsrc、formaction、xlink:href、
// srcdoc、poster、data-* 等，以及将来浏览器新增的属性）一律删除。新增属性要在这里显式加入，不用黑名单。

const set = (...names: string[]): ReadonlySet<string> => new Set(names);

/** 所有元素都可以带的属性（另外允许 aria-*） */
const GLOBAL_ATTRIBUTES = set(
  "class",
  "id",
  "title",
  "lang",
  "dir",
  "style",
  "align",
  "valign",
  "width",
  "height",
  "bgcolor",
  "color",
  "border",
  "role",
);

const TABLE_CELL = set("colspan", "rowspan", "nowrap", "background", "headers", "scope", "abbr");
const TABLE_SECTION = set("background");

/** 按元素额外允许的属性 */
const ELEMENT_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  a: set("href", "name"),
  area: set("href", "alt", "shape", "coords"),
  img: set("src", "srcset", "sizes", "alt", "hspace", "vspace"),
  source: set("srcset", "sizes", "media", "type"),
  table: set("cellpadding", "cellspacing", "summary", "background", "frame", "rules"),
  td: TABLE_CELL,
  th: TABLE_CELL,
  tr: TABLE_SECTION,
  thead: TABLE_SECTION,
  tbody: TABLE_SECTION,
  tfoot: TABLE_SECTION,
  col: set("span"),
  colgroup: set("span"),
  body: set("background", "text", "link", "vlink", "alink"),
  font: set("face", "size"),
  ol: set("start", "type", "reversed"),
  ul: set("type"),
  li: set("value", "type"),
  hr: set("size", "noshade"),
  details: set("open"),
  map: set("name"),
  time: set("datetime"),
};

/** 白名单里承载 URL 的属性，值要再按 URL 策略处理（href 只在 a / area，src 只在 img，srcset 在 img / source） */
export const URL_ATTRIBUTES: ReadonlySet<string> = set("href", "src", "srcset", "background");

export function isAllowedAttribute(tag: string, name: string): boolean {
  if (GLOBAL_ATTRIBUTES.has(name) || name.startsWith("aria-")) return true;
  return ELEMENT_ATTRIBUTES[tag]?.has(name) === true;
}
