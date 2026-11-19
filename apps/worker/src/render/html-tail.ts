// lol-html 对文件末尾不完整的标记（`<img src=x onerror=alert(1)//`、未闭合的 `<!--`）原样输出、不经过任何处理器。
// 只要后面再拼上任何内容（例如 `</body></html>`），浏览器就会把它闭合成一个活的标签。
// 这里扫一遍清洗结果：末尾停在标签或注释里时，从它的 `<` 处截掉。
// 只在 `=` 之后的引号里才认为是引号值（与浏览器一致），所以 `<a title="x>y" href=javascript:...` 也能识别。

type ScanMode = "data" | "tag" | "comment";
type Scan = { mode: ScanMode; start: number; quote: string | null; prev: string };

const TAG_START = /[A-Za-z/!?]/u;
const WHITESPACE = /\s/u;
const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";

export function stripUnfinishedTail(html: string): string {
  const scan: Scan = { mode: "data", start: -1, quote: null, prev: "" };
  let index = 0;
  while (index < html.length) {
    if (scan.mode === "data") index = stepData(scan, html, index);
    else if (scan.mode === "tag") index = stepTag(scan, html, index);
    else index = stepComment(scan, html, index);
  }
  return scan.mode === "data" ? html : html.slice(0, scan.start);
}

function stepData(scan: Scan, html: string, i: number): number {
  if (html[i] !== "<" || !TAG_START.test(html[i + 1] ?? "")) return i + 1;
  scan.start = i;
  if (html.startsWith(COMMENT_OPEN, i)) {
    scan.mode = "comment";
    return i + COMMENT_OPEN.length;
  }
  Object.assign(scan, { mode: "tag", quote: null, prev: "" });
  return i + 1;
}

function stepTag(scan: Scan, html: string, i: number): number {
  const ch = html[i] ?? "";
  if (scan.quote !== null) {
    if (ch === scan.quote) Object.assign(scan, { quote: null, prev: ch });
    return i + 1;
  }
  if (ch === ">") scan.mode = "data";
  else if ((ch === '"' || ch === "'") && scan.prev === "=") scan.quote = ch;
  else if (!WHITESPACE.test(ch)) scan.prev = ch;
  return i + 1;
}

function stepComment(scan: Scan, html: string, i: number): number {
  if (!html.startsWith(COMMENT_CLOSE, i)) return i + 1;
  scan.mode = "data";
  return i + COMMENT_CLOSE.length;
}
