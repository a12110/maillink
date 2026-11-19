// 判定用文本归一化（01 §4.1）：NFKC → 去零宽字符与软连字符 → 合并空白。大小写在比较时处理。
// 规则值、正则、邮件字段都过同一个函数，且函数幂等（重复归一化结果不变），
// 因此 M2 产出的已归一化 MailFacts 再归一化一次不会改变内容。

/**
 * 不可见字符：软连字符、蒙古文元音分隔符、零宽空格 / 连接符 / 不连接符、LRM / RLM、
 * 双向嵌入与隔离控制符、WORD JOINER 等不可见运算符、BOM。
 * 先删一次再做 NFKC：夹在字母与组合符之间的零宽字符会阻止组合，删掉后必须重新组合才能幂等。
 */
const INVISIBLE_CHARS = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu;
const WHITESPACE_RUN = /\s+/gu;
const TRAILING_DOTS = /\.+$/u;

/** 去掉不可见字符并做 NFKC，不动空白 */
export function foldInvisibleAndCompat(value: string): string {
  return value.replace(INVISIBLE_CHARS, "").normalize("NFKC").replace(INVISIBLE_CHARS, "");
}

/** 判定用归一化：NFKC、去不可见字符、空白合并为单个空格并去首尾空白 */
export function normalizeText(value: string): string {
  return foldInvisibleAndCompat(value).replace(WHITESPACE_RUN, " ").trim();
}

/** 域名归一化：normalizeText + 小写 + 去掉末尾的点（`Apple.COM.` → `apple.com`） */
export function normalizeDomain(value: string): string {
  return normalizeText(value).toLowerCase().replace(TRAILING_DOTS, "");
}

/** 一个标签：字母或数字开头结尾，中间可有连字符，最长 63 */
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)*[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u;

/** 是否是合法的（已归一化的）域名：不含 @、通配符、路径、空白 */
export function isValidDomain(normalized: string): boolean {
  return DOMAIN_PATTERN.test(normalized);
}

/**
 * domain_is 语义（02 §3.4）：等于该域名或是其子域名，按点号边界匹配。
 * 两边都应已经过 normalizeDomain。`id.apple.com` 命中 `apple.com`；`fakeapple.com`、`apple.com.evil.io` 不命中。
 */
export function domainIs(candidate: string, ruleDomain: string): boolean {
  if (ruleDomain === "" || candidate === "") return false;
  return candidate === ruleDomain || candidate.endsWith(`.${ruleDomain}`);
}
