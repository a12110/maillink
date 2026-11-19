import { AI_CODE_MAX_LENGTH, CODE_KEYWORD_GAP_MAX } from "../constants";
import {
  CODE_GAP_BLOCKERS,
  CODE_KEYWORDS,
  CODE_NEGATIVE_PREFIXES,
  CODE_UNIT_SUFFIXES,
} from "./data/code-keywords";

// 验证码提取（02 §4.6）。输入是已归一化的文本（NFKC：全角数字已是半角，空白已合并）。
//
// 规则：
//  1. 先看主题，再看正文；每段文本里从左到右找关键词，取第一个合格的候选。
//  2. 候选必须紧邻关键词：
//     - 关键词之后：中间最多 CODE_KEYWORD_GAP_MAX 个字符，不含数字与句末标点（"验证码：123456"、"code is 123456"）。
//     - 关键词之前：只允许"123456 is your <品牌> verification code"这种固定句式。
//  3. 候选形态：4–8 位数字；`123 456` / `123-456` / `1234 5678`（输出时去掉分隔符）；4–8 位字母数字混合（须同时含字母与数字）。
//  4. 排除：年份（1900–2099 的 4 位数）、YYYYMMDD 日期、前缀为 $ € £ ¥ # + / 的数字、后接小数点/千分位/百分号/日期分隔符/单位
//     （元、分钟、seconds…）的数字、关键词与数字之间出现订单/金额/电话等词、紧邻其他字母数字的片段、
//     前缀是掩码（`****1234`）的尾号、后面紧跟折扣字样的优惠码（`SAVE20 for 20% off`）。
//  已知漏判：纯字母验证码；形如 2000 的 4 位数字验证码（被当作年份）；候选与关键词之间超过 24 字符或隔着数字。

const GAP_CHARS = `[^\\d\\n.。!?！？]{0,${CODE_KEYWORD_GAP_MAX}}?`;

/** 关键词之前的搜索窗口：候选(≤9) + "is your" + 最多两个品牌词，留余量 */
const BEFORE_WINDOW_CHARS = 64;
/** 关键词之后需要看的候选长度：最长 "1234 5678" 加上后随的单位判断 */
const AFTER_TOKEN_SPAN = 24;
/** 判断数字后面是不是单位时看的字符数 */
const SUFFIX_LOOKAHEAD = 12;

const MIN_PLAUSIBLE_YEAR = 1900;
const MAX_PLAUSIBLE_YEAR = 2099;
const YEAR_DIGITS = 4;

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 英文关键词里的空格同时匹配空格与连字符 */
const keywordSource = (keyword: string): string => escapeRegex(keyword).replaceAll(" ", "[ -]");

const KEYWORD_ALTERNATION = [...CODE_KEYWORDS]
  .sort((left, right) => right.length - left.length)
  .map(keywordSource)
  .join("|");
const NEGATIVE_PREFIX_ALTERNATION = CODE_NEGATIVE_PREFIXES.map(escapeRegex).join("|");

const KEYWORD_RE = new RegExp(
  `(?<![A-Za-z0-9])(?<!\\b(?:${NEGATIVE_PREFIX_ALTERNATION})[\\s-])(?:${KEYWORD_ALTERNATION})(?![A-Za-z0-9])`,
  "gi",
);

const TOKEN_SOURCE = [
  "(?<![A-Za-z0-9])(?:",
  "\\d{3}[ -]\\d{3}(?![ -]?[A-Za-z0-9])",
  "|\\d{4}[ -]\\d{4}(?![ -]?[A-Za-z0-9])",
  "|\\d{4,8}(?![A-Za-z0-9])",
  "|(?=[A-Za-z]*\\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{4,8}(?![A-Za-z0-9])",
  ")",
].join("");

const AFTER_RE = new RegExp(`^(${GAP_CHARS})(${TOKEN_SOURCE})`);
const BEFORE_RE = new RegExp(
  `(${TOKEN_SOURCE})\\s*(?:(?:is|was|为|為|是|は|が|:|：|-)\\s*)?(?:(?:your|the|this|您的|你的|本次|该|該)\\s*)?(?:[A-Za-z]{1,15}\\s+){0,2}$`,
);

/** 纯 ASCII 的阻断词按整词匹配（避免 "hotel" 命中 "tel"） */
const blockerSource = (word: string): string =>
  /^[\x20-\x7e]+$/.test(word) ? `\\b${escapeRegex(word)}\\b` : escapeRegex(word);
const GAP_BLOCKER_RE = new RegExp(CODE_GAP_BLOCKERS.map(blockerSource).join("|"), "i");
const UNIT_SUFFIX_RE = new RegExp(`^\\s?(?:${CODE_UNIT_SUFFIXES.map(escapeRegex).join("|")})(?![a-z])`, "i");
/** 货币、井号、加号、斜杠，以及掩码与小数点（`****1234` 是卡号/手机号尾号，不是验证码） */
const BAD_PREFIX_RE = /[$€£¥￥#+/*•×·●.]/;
/** 掩码字符后隔一个空格的尾号：`•••• 1234` */
const MASKED_PREFIX_RE = /[*•×·●] $/;
/** 小数点、千分位（NFKC 会把全角逗号变成半角，所以逗号后必须正好三位才算千分位）、百分号、日期分隔 */
const BAD_SUFFIX_RE = /^(?:\.\d|,\d{3}(?!\d)|[/%]|-\d)/;
/** 数字后面不远处出现折扣字样：优惠码（"Use code SAVE20 for 20% off"），不是验证码 */
const PROMO_SUFFIX_RE = /^[^.!?]{0,40}?(?:%|\b(?:off|discount|savings?)\b)/i;
const PROMO_LOOKAHEAD = 40;
const DATE_8_RE = /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/;

function isYearLike(digits: string): boolean {
  if (digits.length !== YEAR_DIGITS) return false;
  const year = Number(digits);
  return year >= MIN_PLAUSIBLE_YEAR && year <= MAX_PLAUSIBLE_YEAR;
}

/** 在候选周围的原文里排除年份、日期、金额、电话、时长等 */
function isPlausibleCode(text: string, start: number, token: string): boolean {
  const digits = token.replace(/[ -]/g, "");
  const before = text.charAt(start - 1);
  const after = text.slice(start + token.length, start + token.length + SUFFIX_LOOKAHEAD);
  if (/[A-Za-z0-9]/.test(before) || BAD_PREFIX_RE.test(before)) return false;
  if (MASKED_PREFIX_RE.test(text.slice(Math.max(0, start - 2), start))) return false;
  if (BAD_SUFFIX_RE.test(after) || UNIT_SUFFIX_RE.test(after)) return false;
  if (PROMO_SUFFIX_RE.test(text.slice(start + token.length, start + token.length + PROMO_LOOKAHEAD))) return false;
  if (/^\d+$/.test(digits) && (isYearLike(digits) || DATE_8_RE.test(digits))) return false;
  return true;
}

function matchAfterKeyword(text: string, keywordEnd: number): string | null {
  const rest = text.slice(keywordEnd, keywordEnd + CODE_KEYWORD_GAP_MAX + AFTER_TOKEN_SPAN);
  const match = AFTER_RE.exec(rest);
  const gap = match?.[1];
  const token = match?.[2];
  if (gap === undefined || token === undefined) return null;
  if (GAP_BLOCKER_RE.test(gap)) return null;
  return isPlausibleCode(text, keywordEnd + gap.length, token) ? token : null;
}

function matchBeforeKeyword(text: string, keywordStart: number): string | null {
  const windowStart = Math.max(0, keywordStart - BEFORE_WINDOW_CHARS);
  const match = BEFORE_RE.exec(text.slice(windowStart, keywordStart));
  const token = match?.[1];
  if (match === null || token === undefined) return null;
  return isPlausibleCode(text, windowStart + match.index, token) ? token : null;
}

function findCode(text: string): string | null {
  for (const hit of text.matchAll(KEYWORD_RE)) {
    const token =
      matchAfterKeyword(text, hit.index + hit[0].length) ?? matchBeforeKeyword(text, hit.index);
    if (token !== null) return token.replace(/[ -]/g, "");
  }
  return null;
}

/** 内置提取：先主题后正文。返回去掉分隔符的验证码 */
export function extractBuiltinCode(subject: string, body: string): string | null {
  return findCode(subject) ?? findCode(body);
}

/**
 * temp_email 的 metadata.ai_extract：type 为 auth_code 且 result 是 1–AI_CODE_MAX_LENGTH 个字符时采用。
 * metadata 不是合法 JSON 或结构不符时返回 null（回退到内置提取），并在日志里留痕。
 */
export function extractAiCode(metadata: string | null): string | null {
  if (!metadata) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch (error) {
    console.warn("mail metadata 不是合法 JSON，忽略 ai_extract", error);
    return null;
  }
  const extract = (parsed as { ai_extract?: { type?: unknown; result?: unknown } } | null)?.ai_extract;
  if (extract?.type !== "auth_code") return null;
  const { result } = extract;
  if (typeof result !== "string" && typeof result !== "number") return null;
  const code = String(result).trim();
  return code.length > 0 && code.length <= AI_CODE_MAX_LENGTH ? code : null;
}

export type CodeResult = { code: string | null; source: "ai_extract" | "builtin" | null };

/** ai_extract → 内置（规则组级 code_regex 在 rules/，由 M3a 插在两者之间） */
export function resolveCode(subject: string, body: string, metadata: string | null): CodeResult {
  const aiCode = extractAiCode(metadata);
  if (aiCode !== null) return { code: aiCode, source: "ai_extract" };
  const builtin = extractBuiltinCode(subject, body);
  return builtin === null ? { code: null, source: null } : { code: builtin, source: "builtin" };
}
