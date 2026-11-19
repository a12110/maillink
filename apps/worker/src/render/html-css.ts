// 邮件 HTML 里 CSS（style 属性与 <style> 元素）的处理策略：
//   - 去掉注释后，含反斜杠（CSS 转义可以把 expression / url 拆写成 \65 xpression、u\72l）或 `<` 的整段丢弃；
//   - 含 expression( / javascript: / vbscript: / behavior: / -moz-binding / @import / image-set( / image( / src( 的整段丢弃
//     （前几项只对旧 IE 有效，现代浏览器不执行，这里是纵深防御；@import、image-set、src() 会绕开 url() 处理去加载远程资源）；
//   - url(...)：data:image/* 保留；remote_images=allow 时 https 保留；其余替换成 none（阻止追踪像素与字体等远程加载）；
//     有 url( 却找不到配对的 ) 时整段丢弃（CSS 允许未闭合的 url 到声明结尾）。
// 真正的兜底是 srcdoc 里的 CSP（img-src data: / default-src 'none'），即使这里漏了，远程加载也会被浏览器拦下。

const COMMENT = /\/\*[\s\S]*?\*\//gu;
const FORBIDDEN_CHARS = /[\\<]/u;
const DANGEROUS =
  /expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding|@import|image-set\s*\(|(?:^|[^-\w])(?:image|src)\s*\(/iu;
const URL_OPEN = /url\s*\(/giu;
const URL_CALL = /url\s*\(([^)]*)\)/giu;

export function sanitizeCss(css: string, remoteImages: "block" | "allow"): string | null {
  const stripped = css.replace(COMMENT, "");
  if (FORBIDDEN_CHARS.test(stripped) || DANGEROUS.test(stripped)) return null;
  const opens = stripped.match(URL_OPEN)?.length ?? 0;
  const calls = stripped.match(URL_CALL)?.length ?? 0;
  if (opens !== calls) return null;
  return stripped.replace(URL_CALL, (whole, inner: string) => (keepCssUrl(inner, remoteImages) ? whole : "none"));
}

function keepCssUrl(inner: string, remoteImages: "block" | "allow"): boolean {
  const target = inner.trim().replace(/^(['"])([\s\S]*)\1$/u, "$2").trim();
  if (/^data:image\//iu.test(target)) return true;
  return remoteImages === "allow" && /^https:\/\//iu.test(target);
}
