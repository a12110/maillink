// 测试里读 wrangler.jsonc：workerd 里没有真实文件系统，用 Vite 的 glob 在构建期把文件读进来。

const wranglerSource = import.meta.glob("../wrangler.jsonc", { query: "?raw", import: "default", eager: true });

/** 去掉 JSONC 的 // 与块注释（跳过字符串里的内容，例如 "http://…"）以及尾随逗号 */
export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;
    const next = text[i + 1];
    if (char === '"') {
      const end = endOfString(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
    } else if (char === "/" && next === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close < 0 ? text.length : close + 2;
    } else {
      out += char;
      i += 1;
    }
  }
  return out.replace(/,(\s*[}\]])/gu, "$1");
}

/** 从开引号位置找到字符串结束后的下标（处理反斜杠转义） */
function endOfString(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
  return i + 1;
}

/** 解析后的 wrangler.jsonc；调用方按需断言自己关心的字段 */
export function readWranglerConfig<T>(): T {
  const [source] = Object.values(wranglerSource);
  if (source === undefined) throw new Error("没有读到 wrangler.jsonc");
  return JSON.parse(stripJsonc(source)) as T;
}
