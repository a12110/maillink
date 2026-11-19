import {
  BILLING,
  EMAIL_CHANGE,
  LOGIN_LINK_KEYWORDS,
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

export type ClassifyInput = {
  subject: string;
  body: string;
  code: string | null;
  links: readonly string[];
};

export function classifyMail(input: ClassifyInput): MailCategory {
  const subject = input.subject.toLowerCase();
  const content = `${subject} ${input.body.toLowerCase()}`;
  for (const [category, keywords] of ORDERED_CATEGORIES) {
    if (includesAny(subject, keywords.subject) || includesAny(content, keywords.body)) return category;
  }
  // 没有验证码时，带链接且有"登录 / 确认邮箱"字样的算登录链接类（02 §3.6 的"提取到验证码或登录链接"）
  const hasLoginLink = input.links.length > 0 && includesAny(content, LOGIN_LINK_KEYWORDS);
  return input.code !== null || hasLoginLink ? "verification" : "other";
}
