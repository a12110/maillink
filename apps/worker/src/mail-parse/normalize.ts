// 判定用文本归一化（01 §4.1）：NFKC → 去零宽字符与软连字符 → 合并空白。大小写在比较时处理。

/** 零宽字符、软连字符、双向控制符、不可见运算符、BOM */
const INVISIBLE_CHARS = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

export function normalizeText(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE_CHARS, "").replace(/\s+/g, " ").trim();
}

/** 展示用归一化：NFKC、去不可见字符、每行内部合并空白、保留换行、连续空行最多一个 */
export function normalizeDisplayText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE_CHARS, "")
    .replace(/\r\n?|[\u2028\u2029\v\f]/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const CONTINUATION_BYTE_MASK = 0xc0;
const CONTINUATION_BYTE = 0x80;

/** 按 UTF-8 字节数截断，不切断多字节字符。未超限时原样返回 */
export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return { text, truncated: false };
  let cut = maxBytes;
  // 截断点落在多字节字符中间（续字节）时向前退到字符起点
  while (cut > 0 && ((bytes[cut] ?? 0) & CONTINUATION_BYTE_MASK) === CONTINUATION_BYTE) cut--;
  return { text: new TextDecoder().decode(bytes.subarray(0, cut)).trimEnd(), truncated: true };
}
