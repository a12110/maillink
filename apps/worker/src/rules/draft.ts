import {
  analyzeRegexPattern,
  compileUserRegex,
  escapeRegExp,
  isValidDomain,
  normalizeDomain,
  normalizeText,
  RULE_GROUP_LIMITS,
  type Cond,
  type Rule,
} from "@maillink/shared";
import { cleanCode, extractWithRegex } from "./extract";
import type { MailFacts } from "./facts";

// "以此邮件创建规则"（04 draft-from-mail，06 §3.1 L3）：从一封真实的登录验证码邮件生成一条 allow 规则草稿。
//
// 主题模式的泛化策略（生成 `^...$` 的整句匹配，所以是严格的 L3 主题白名单）：
//   - 验证码本身（按 facts.code 找，容忍空格 / 连字符）→ 保留形状：数字段 `\d{n}`，字母数字段 `[a-z0-9]{n}`（不区分大小写）；
//   - 邮箱地址 → `[^\s@]+@[^\s@]+`（主题里常带收件地址，每个别名都不同）；
//   - 其余数字串（日期、订单号）→ 每段 `\d+`，保留中间的分隔符；
//   - 其余文字按字面转义。
//   超过正则长度上限时只保留前缀并去掉结尾的 `$`。生成的模式不含嵌套重复，能通过保存时的静态检查。
// 验证码正则：取验证码前面紧邻的 1–2 个不含数字的词作锚点，`锚点\s*(形状)`；没有锚点时用 `\b(形状)\b`。

/** iCloud 等转发服务的域名：不能作为发件人白名单，否则会放行所有经它转发的邮件 */
const RELAY_DOMAINS: readonly string[] = ["icloud.com", "me.com", "mac.com", "privaterelay.appleid.com"];

/** 验证码前面取锚点的窗口（字符）与锚点最长字符数 */
const CODE_CONTEXT_WINDOW = 24;
const CODE_CONTEXT_MAX_CHARS = 12;
const CODE_CONTEXT_MAX_WORDS = 2;

export type RuleDraft = {
  /** 草稿规则；既没有可用的发件人域名也没有主题时为 null */
  rule: Rule | null;
  subject_pattern: string | null;
  /** 建议填到 present.code_regex 的正则 */
  code_regex: string | null;
  /** 给管理员看的说明：泛化了什么、哪里需要人工确认 */
  notes: string[];
};

type Span = { start: number; end: number; kind: "code" | "email" | "digits" };

export function draftRuleFromMail(facts: MailFacts): RuleDraft {
  const notes: string[] = [];
  const domains = draftSenderDomains(facts, notes);
  const subjectPattern = buildSubjectPattern(facts, notes);
  const codeRegex = buildCodeRegex(facts, notes);
  const conditions: Cond[] = [];
  if (domains.length > 0) conditions.push({ field: "sender.domain", op: "domain_is", value: domains });
  if (facts.category === "verification") {
    conditions.push({ field: "category", op: "eq", value: "verification" });
  } else {
    notes.push(`这封邮件的内置分类是 ${facts.category}，不是 verification，草稿没有加分类条件；请确认它确实是登录验证码邮件`);
  }
  if (subjectPattern !== null) conditions.push({ field: "subject", op: "regex", value: subjectPattern });
  if (domains.length === 0 && subjectPattern === null) {
    notes.push("既没有可用的发件人域名也没有主题，无法生成规则");
    return { rule: null, subject_pattern: null, code_regex: codeRegex, notes };
  }
  const name = `${domains[0] ?? "未知发件人"} 登录验证码`.slice(0, RULE_GROUP_LIMITS.maxNameLength);
  const rule: Rule = { id: `draft-${facts.mail_id}`, name, enabled: true, effect: "allow", when: { all: conditions } };
  return { rule, subject_pattern: subjectPattern, code_regex: codeRegex, notes };
}

function draftSenderDomains(facts: MailFacts, notes: string[]): string[] {
  const all = [...new Set(facts.sender.domains.map(normalizeDomain))].filter(isValidDomain);
  const relays = all.filter((domain) => RELAY_DOMAINS.includes(domain));
  if (relays.length > 0) notes.push(`已排除转发服务域名 ${relays.join("、")}：它们会放行所有经其转发的邮件`);
  const domains = all.filter((domain) => !RELAY_DOMAINS.includes(domain));
  if (domains.length === 0) notes.push("没有可用的发件人域名，请手动填写");
  else notes.push(`发件人域名取自候选集合（From 与 iCloud 转发头）：${domains.join("、")}；可改成可注册域名以覆盖子域名`);
  return domains;
}

// ---- 主题模式 ----

function buildSubjectPattern(facts: MailFacts, notes: string[]): string | null {
  const subject = normalizeText(facts.subject);
  if (subject === "") {
    notes.push("主题为空，未生成主题条件");
    return null;
  }
  const parts = subjectParts(subject, findSpans(subject, facts.code));
  const { pattern, truncated } = assemble(parts);
  if (truncated) notes.push(`主题较长，主题模式只匹配前缀（正则上限 ${RULE_GROUP_LIMITS.maxRegexLength} 字符）`);
  notes.push("主题模式里的验证码、邮箱地址、数字已泛化，其余文字按原样匹配");
  const regex = compileUserRegex(pattern, { caseSensitive: false, global: false });
  if (!regex.test(subject) || analyzeRegexPattern(pattern).length > 0) {
    throw new Error(`生成的主题模式不匹配原主题或未通过静态检查：${pattern}`);
  }
  return pattern;
}

function findSpans(subject: string, code: string | null): Span[] {
  const spans: Span[] = [];
  const cleaned = code === null ? null : cleanCode(code);
  if (cleaned !== null) {
    for (const m of subject.matchAll(flexibleCodeRegex(cleaned, "giu"))) spans.push(spanOf(m, "code"));
  }
  for (const m of subject.matchAll(/[^\s@]+@[^\s@]+\.[^\s@]+/gu)) spans.push(spanOf(m, "email"));
  for (const m of subject.matchAll(/\d+(?:[ -]\d+)*/gu)) spans.push(spanOf(m, "digits"));
  // 按优先级（code > email > digits）去掉重叠
  const accepted: Span[] = [];
  for (const span of spans) {
    if (!accepted.some((a) => span.start < a.end && a.start < span.end)) accepted.push(span);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

function spanOf(match: RegExpMatchArray, kind: Span["kind"]): Span {
  const start = match.index ?? 0;
  return { start, end: start + match[0].length, kind };
}

/** 匹配验证码本身：字符间容忍一个空格或连字符，两侧不能紧挨字母数字 */
function flexibleCodeRegex(code: string, flags: string): RegExp {
  const body = [...code].map(escapeRegExp).join("[ -]?");
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, flags);
}

type Part = { literal: boolean; text: string };

function subjectParts(subject: string, spans: Span[]): Part[] {
  const parts: Part[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) parts.push({ literal: true, text: subject.slice(cursor, span.start) });
    parts.push({ literal: false, text: generalize(subject.slice(span.start, span.end), span.kind) });
    cursor = span.end;
  }
  if (cursor < subject.length) parts.push({ literal: true, text: subject.slice(cursor) });
  return parts;
}

function generalize(text: string, kind: Span["kind"]): string {
  if (kind === "code") return codeShape(text);
  if (kind === "email") return "[^\\s@]+@[^\\s@]+";
  return text.split(/([ -])/u).map((piece) => (/^\d+$/u.test(piece) ? "\\d+" : escapeRegExp(piece))).join("");
}

/** 验证码形状：数字段 \d{n}，含字母的段 [a-z0-9]{n}，分隔符 [ -]? */
function codeShape(text: string): string {
  return text
    .split(/[ -]/u)
    .map((group) => (/^\d+$/u.test(group) ? `\\d{${group.length}}` : `[a-z0-9]{${group.length}}`))
    .join("[ -]?");
}

const codePoints = (value: string): number => [...value].length;

function assemble(parts: Part[]): { pattern: string; truncated: boolean } {
  const budget = RULE_GROUP_LIMITS.maxRegexLength - 1;
  let pattern = "^";
  for (const part of parts) {
    const piece = part.literal ? escapeRegExp(part.text) : part.text;
    if (codePoints(pattern) + codePoints(piece) <= budget) {
      pattern += piece;
      continue;
    }
    if (part.literal) pattern += fitLiteral(part.text, budget - codePoints(pattern));
    return { pattern, truncated: true };
  }
  return { pattern: `${pattern}$`, truncated: false };
}

/** 在剩余长度内逐字符放入转义后的字面量，不切断转义序列 */
function fitLiteral(text: string, room: number): string {
  let result = "";
  for (const char of text) {
    const escaped = escapeRegExp(char);
    if (codePoints(result) + codePoints(escaped) > room) break;
    result += escaped;
  }
  return result.replace(/ +$/u, "");
}

// ---- 验证码正则 ----

function buildCodeRegex(facts: MailFacts, notes: string[]): string | null {
  const code = facts.code === null ? null : cleanCode(facts.code);
  if (code === null) {
    notes.push("这封邮件没有提取到验证码，未生成验证码正则");
    return null;
  }
  for (const text of [normalizeText(facts.subject), normalizeText(facts.body)]) {
    const match = flexibleCodeRegex(code, "iu").exec(text);
    if (match === null) continue;
    const context = precedingContext(text, match.index);
    const shape = codeShape(match[0]);
    const pattern = context === null ? `\\b(${shape})\\b` : `${context}\\s*(${shape})`;
    if (codePoints(pattern) > RULE_GROUP_LIMITS.maxRegexLength || analyzeRegexPattern(pattern).length > 0) break;
    const check = extractWithRegex(compileUserRegex(pattern, { caseSensitive: false, global: false }), facts);
    if (check.code !== code) {
      notes.push(`生成的验证码正则 ${pattern} 在这封邮件上提取到的不是 ${code}，未采用`);
      return null;
    }
    notes.push(`验证码正则以验证码前的文字为锚点：${pattern}`);
    return pattern;
  }
  notes.push("验证码没有原样出现在主题或正文里（可能来自 ai_extract），未生成验证码正则");
  return null;
}

/** 句读：锚点不跨过它们（"您好，您的验证码是" 只取"您的验证码是"）；冒号保留，它常是锚点的一部分 */
const CLAUSE_BREAK = /[,;!?。，；！？]([^,;!?。，；！？]*)$/u;

/** 验证码前面窗口内、最后一个句读之后的词 */
function wordsBefore(text: string, index: number): string[] {
  const windowStart = Math.max(0, index - CODE_CONTEXT_WINDOW);
  const before = text.slice(windowStart, index);
  const clause = CLAUSE_BREAK.exec(before);
  const words = (clause === null ? before : (clause[1] ?? "")).split(" ").filter((word) => word !== "");
  // 没有句读且窗口起点落在词中间时，丢掉这半个词
  if (clause === null && windowStart > 0 && text[windowStart - 1] !== " ") words.shift();
  return words;
}

/** 验证码前面紧邻的 1–2 个不含数字的词（不跨句读），转成正则；没有时返回 null */
function precedingContext(text: string, index: number): string | null {
  const words = wordsBefore(text, index);
  const picked: string[] = [];
  for (let i = words.length - 1; i >= 0 && picked.length < CODE_CONTEXT_MAX_WORDS; i -= 1) {
    const word = words[i] as string;
    if (/\d/u.test(word)) break;
    picked.unshift(word);
  }
  if (picked.length === 0) return null;
  const context = [...picked.join(" ")].slice(-CODE_CONTEXT_MAX_CHARS).join("").trim();
  return context === "" ? null : escapeRegExp(context).replace(/ /gu, "\\s+");
}
