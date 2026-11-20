// 正则原子的字符集粗分类（静态检查"相邻重叠的无上限重复"用）。
// 只分四类：数字、字母与下划线、空白、其他；判"可能重叠"时宁可多报（取反、\p{…}、. 一律视为全部）。

export const CHARSET_DIGIT = 1;
export const CHARSET_WORD = 2;
export const CHARSET_SPACE = 4;
export const CHARSET_OTHER = 8;
export const CHARSET_ANY = CHARSET_DIGIT | CHARSET_WORD | CHARSET_SPACE | CHARSET_OTHER;
export const CHARSET_BITS: readonly number[] = [CHARSET_DIGIT, CHARSET_WORD, CHARSET_SPACE, CHARSET_OTHER];

const CLASS_ESCAPES: Readonly<Record<string, number>> = {
  d: CHARSET_DIGIT,
  w: CHARSET_DIGIT | CHARSET_WORD,
  s: CHARSET_SPACE,
  D: CHARSET_WORD | CHARSET_SPACE | CHARSET_OTHER,
  W: CHARSET_SPACE | CHARSET_OTHER,
  S: CHARSET_DIGIT | CHARSET_WORD | CHARSET_OTHER,
  n: CHARSET_SPACE,
  r: CHARSET_SPACE,
  t: CHARSET_SPACE,
  f: CHARSET_SPACE,
  v: CHARSET_SPACE,
  p: CHARSET_ANY,
  P: CHARSET_ANY,
  k: CHARSET_ANY,
};

export function charCategory(ch: string): number {
  if (/^[0-9]$/u.test(ch)) return CHARSET_DIGIT;
  if (/^[A-Za-z_]$/u.test(ch)) return CHARSET_WORD;
  if (/^\s$/u.test(ch)) return CHARSET_SPACE;
  return CHARSET_OTHER;
}

/** `\` 之后的转义（不在字符类里）对应的字符集；`\b` `\B` 是零宽断言，返回 0 */
export function escapeCharset(next: string): number {
  if (next === "b" || next === "B") return 0;
  if (/^[1-9]$/u.test(next)) return CHARSET_ANY;
  if (next === "u" || next === "x") return CHARSET_ANY;
  return CLASS_ESCAPES[next] ?? charCategory(next);
}

/** 字符类里从 i 开始的一项（转义、范围或单个字符）：返回字符集与下一项的位置 */
function classItem(body: string, i: number): { chars: number; next: number } {
  const ch = body[i] ?? "";
  if (ch === "\\") {
    const escaped = body[i + 1] ?? "";
    // 字符类里的 \b 是退格符；其余转义按类别，未知的按"其他"
    return { chars: escaped === "b" ? CHARSET_OTHER : escapeCharset(escaped) || CHARSET_OTHER, next: i + 2 };
  }
  const end = body[i + 2];
  if (body[i + 1] === "-" && end !== undefined && end !== "\\") {
    const start = charCategory(ch);
    return { chars: start === charCategory(end) ? start : CHARSET_ANY, next: i + 3 };
  }
  return { chars: charCategory(ch), next: i + 1 };
}

/** 字符类 `[...]` 的字符集；body 是方括号内的原文（不含方括号）。取反一律视为全部 */
export function classCharset(body: string): number {
  if (body.startsWith("^")) return CHARSET_ANY;
  let chars = 0;
  let i = 0;
  while (i < body.length) {
    const item = classItem(body, i);
    chars |= item.chars;
    i = item.next;
  }
  return chars;
}
