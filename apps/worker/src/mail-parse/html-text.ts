// html → 文本：用 HTMLRewriter 流式解析（无 DOM），丢掉 script / style / template 的内容，
// 同时收集 <a href>。这里只做"取文字"，不是清洗器——给用户展示的 HTML 清洗在 render/（M3a）。
// 文字用 onDocument 收集：不在任何元素里的顶层文字（"Your code 123<br>"）元素级的 text 回调拿不到。
// 不跳过 head：省略 </head> 的邮件里 skipDepth 不会回落，后面的正文与链接会被整个吞掉。
// 输出保留换行（块级标签处），判定路径之后统一经 normalizeText 合并空白，展示路径经 normalizeDisplayText。

const SKIPPED_TAGS = "script, style, template";

/** 块级标签两侧输出换行，避免相邻块的文字粘成一个词，也让展示文本保留段落 */
const BLOCK_TAGS = new Set([
  "p", "div", "li", "ul", "ol", "tr", "table", "tbody", "thead", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "section", "article", "header", "footer", "dd", "dt", "dl",
]);
/** 没有结束标签的块级元素：只在开始处输出换行 */
const VOID_BREAK_TAGS = new Set(["br", "hr"]);
/** 表格单元格：用空格分隔 */
const CELL_TAGS = new Set(["td", "th"]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  copy: "©", reg: "®", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", zwnj: "\u200C", zwj: "\u200D",
};

const MAX_CODE_POINT = 0x10ffff;

function decodeNumeric(digits: string, radix: number, original: string): string {
  const codePoint = Number.parseInt(digits, radix);
  if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > MAX_CODE_POINT) return original;
  // 代理区码点不是合法字符
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return original;
  return String.fromCodePoint(codePoint);
}

/** 解码常见 HTML 实体；认不出的原样保留 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,8}));/g, (match, dec, hex, name) => {
    if (dec !== undefined) return decodeNumeric(dec, 10, match);
    if (hex !== undefined) return decodeNumeric(hex, 16, match);
    return NAMED_ENTITIES[(name as string).toLowerCase()] ?? match;
  });
}

export type HtmlExtract = {
  /** 可见文字，未归一化（由调用方统一归一化） */
  text: string;
  /** <a href> 的值，按文档顺序 */
  hrefs: string[];
};

export async function extractHtml(html: string): Promise<HtmlExtract> {
  let skipDepth = 0;
  // 块级标签只"登记"一次换行，等下一段有内容的文字到来时再输出：相邻块之间只有一个换行，
  // 源码里缩进用的空白文本不会变成空行
  let breakPending = false;
  const chunks: string[] = [];
  const hrefs: string[] = [];

  const rewriter = new HTMLRewriter()
    .onDocument({
      text(chunk) {
        if (skipDepth > 0) return;
        // HTML 里源码的换行与缩进只是空白；真正的换行由块级标签产生
        const text = chunk.text.replace(/\s+/g, " ");
        if (text.trim() !== "" && breakPending) {
          chunks.push("\n");
          breakPending = false;
        }
        chunks.push(text);
      },
    })
    .on(SKIPPED_TAGS, {
      element(element) {
        skipDepth++;
        element.onEndTag(() => {
          skipDepth--;
        });
      },
    })
    .on("a[href]", {
      element(element) {
        const href = element.getAttribute("href");
        if (skipDepth === 0 && href) hrefs.push(decodeHtmlEntities(href));
      },
    })
    .on("*", {
      element(element) {
        if (skipDepth > 0) return;
        const tag = element.tagName;
        if (VOID_BREAK_TAGS.has(tag)) {
          chunks.push("\n");
          breakPending = false;
        } else if (CELL_TAGS.has(tag)) {
          chunks.push(" ");
        } else if (BLOCK_TAGS.has(tag)) {
          breakPending = true;
          element.onEndTag(() => {
            breakPending = true;
          });
        }
      },
    });

  // 只为驱动解析；输出的 HTML 不使用
  await rewriter.transform(new Response(html)).arrayBuffer();
  return { text: decodeHtmlEntities(chunks.join("")), hrefs };
}
