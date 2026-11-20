import {
  BILLING,
  EMAIL_CHANGE,
  LOGIN_LINK_KEYWORDS,
  NOT_YOU_MARKERS,
  PASSWORD_RESET,
  SECURITY_CHANGE,
} from "./data/category-keywords";
import type { CategoryKeywords } from "./data/category-keywords";
import type { MailCategory } from "./facts";

// 邮件分类（02 §3.6）：按 email_change → password_reset → security_change → billing → verification → other 的顺序，
// 命中即停，高危类别优先。依据主题与正文里的多语言关键词表，是启发式的。

const ORDERED_CATEGORIES: ReadonlyArray<readonly [MailCategory, CategoryKeywords]> = [
  ["email_change", EMAIL_CHANGE],
  ["password_reset", PASSWORD_RESET],
  ["security_change", SECURITY_CHANGE],
  ["billing", BILLING],
];

const includesAny = (text: string, keywords: readonly string[]): boolean =>
  keywords.some((keyword) => text.includes(keyword));

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 页脚条件句的引导部分："如果不是你本人"一类开头（只收中、英），到第一个逗号为止（含逗号后的空白）。
 * 必须在正文开头或句末标点之后；引导部分里不能有句末标点。
 */
const NOT_YOU_LEAD = new RegExp(`(?:^|[.!?。！？]\\s*)(?:${NOT_YOU_MARKERS.map(escapeRegExp).join("|")})[^,，.!?。！？]*[,，]\\s*`, "g");

/** 建议分句的开头：可选的礼貌 / 情态前缀 + 祈使建议动词（文本已转小写） */
const ADVICE_START =
  /^(?:(?:please|you can|you should|we recommend(?: that)?(?: you)?) )?(?:reset|change|update|secure)\b|^(?:请|建议)?(?:您|你)?(?:立即|及时|尽快)?(?:修改|重置|更改|重设)/;

/** 分句在这些字符处结束（逗号、分号、冒号、破折号、句末标点、换行） */
const CLAUSE_END = /[,，;；:：—–.!?。！？\n]/;

/** 建议分句的最大长度（字符）：超过就不当作建议，整段照常参与匹配 */
const MAX_ADVICE_CLAUSE_CHARS = 80;

/** 引导语逗号之后那一个分句的长度；不是建议分句时返回 0 */
function adviceClauseLength(rest: string): number {
  if (!ADVICE_START.test(rest)) return 0;
  const end = rest.search(CLAUSE_END);
  const length = end === -1 ? rest.length : end;
  return length <= MAX_ADVICE_CLAUSE_CHARS ? length : 0;
}

/**
 * 只去掉"If you didn't request this, you can reset your password"里紧跟引导语逗号、以建议动词开头的那一个分句；
 * 引导部分、后续分句与其他句子照常参与匹配。其他语言不处理。
 */
export function dropNotYouAdvice(body: string): string {
  let kept = "";
  let cursor = 0;
  for (const match of body.matchAll(NOT_YOU_LEAD)) {
    const clauseStart = match.index + match[0].length;
    const length = adviceClauseLength(body.slice(clauseStart));
    if (length === 0 || clauseStart < cursor) continue;
    kept += body.slice(cursor, clauseStart);
    cursor = clauseStart + length;
  }
  return kept + body.slice(cursor);
}

export type ClassifyInput = {
  subject: string;
  body: string;
  code: string | null;
  links: readonly string[];
};

export function classifyMail(input: ClassifyInput): MailCategory {
  const subject = input.subject.toLowerCase();
  const body = input.body.toLowerCase();
  const content = `${subject} ${body}`;
  const riskContent = `${subject} ${dropNotYouAdvice(body)}`;
  for (const [category, keywords] of ORDERED_CATEGORIES) {
    if (includesAny(subject, keywords.subject) || includesAny(riskContent, keywords.body)) return category;
  }
  // 没有验证码时，带链接且有"登录 / 确认邮箱"字样的算登录链接类（02 §3.6 的"提取到验证码或登录链接"）
  const hasLoginLink = input.links.length > 0 && includesAny(content, LOGIN_LINK_KEYWORDS);
  return input.code !== null || hasLoginLink ? "verification" : "other";
}
