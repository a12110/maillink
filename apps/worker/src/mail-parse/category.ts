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
 * 句首是"如果不是你本人"一类条件、到第一个逗号为前半句，之后到句末是建议。
 * 句子按 . ! ? 。！？ 切分（正文已合并空白，换行不再是边界）；没有逗号的条件句不处理。
 */
const NOT_YOU_ADVICE = new RegExp(
  `(^|[.!?。！？]\\s*)((?:${NOT_YOU_MARKERS.map(escapeRegExp).join("|")})[^,，、.!?。！？]*[,，、])[^.!?。！？]*`,
  "g",
);

/** 去掉页脚条件句后半句的建议（"…, you can reset your password"），前半句保留 */
const dropNotYouAdvice = (body: string): string => body.replace(NOT_YOU_ADVICE, "$1$2");

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
