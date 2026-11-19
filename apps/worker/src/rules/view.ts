import { normalizeDomain, normalizeText, type ExtractedValues, type RuleField } from "@maillink/shared";
import type { MailCategory, MailFacts } from "./facts";

// 一封邮件在一次求值里的"字段视图"：字段值归一化一次、小写一次，之后所有条件复用。
// MailFacts 的 subject / body 已由 M2 归一化，这里再归一化一次是幂等的，用来兜住来源不一致。

export type TextField = Extract<
  RuleField,
  | "sender.address"
  | "sender.domain"
  | "sender.name"
  | "sender.envelope"
  | "recipient"
  | "subject"
  | "body"
  | "content"
  | "link.domains"
  | "attachment.name"
>;
export type BoolField = Extract<RuleField, "code.present" | "login_link.present" | "has_attachment">;

const optional = (value: string | null): string[] => (value === null ? [] : [normalizeText(value)]);

const TEXT_SOURCES: Record<Exclude<TextField, "content">, (facts: MailFacts) => string[]> = {
  "sender.address": (f) => f.sender.addresses.map(normalizeText),
  "sender.domain": (f) => f.sender.domains.map(normalizeDomain),
  "sender.name": (f) => optional(f.sender.name),
  "sender.envelope": (f) => optional(f.sender.envelope),
  recipient: (f) => [normalizeText(f.recipient)],
  subject: (f) => [normalizeText(f.subject)],
  body: (f) => [normalizeText(f.body)],
  "link.domains": (f) => f.link_domains.map(normalizeDomain),
  "attachment.name": (f) => f.attachments.map((a) => normalizeText(a.name)),
};

export class MailView {
  private readonly exact = new Map<TextField, readonly string[]>();
  private readonly lower = new Map<TextField, readonly string[]>();

  constructor(
    readonly facts: MailFacts,
    readonly extracted: ExtractedValues,
  ) {}

  /** 文本 / 列表字段的值（标量字段是单元素或空数组）；caseSensitive=false 时为小写 */
  texts(field: TextField, caseSensitive: boolean): readonly string[] {
    if (caseSensitive) return this.exactValues(field);
    let values = this.lower.get(field);
    if (values === undefined) {
      values = this.exactValues(field).map((value) => value.toLowerCase());
      this.lower.set(field, values);
    }
    return values;
  }

  bool(field: BoolField): boolean {
    if (field === "code.present") return this.extracted.code !== null;
    if (field === "login_link.present") return this.extracted.login_link !== null;
    return this.facts.attachments.length > 0;
  }

  size(): number {
    return this.facts.raw_size;
  }

  category(): MailCategory {
    return this.facts.category;
  }

  private exactValues(field: TextField): readonly string[] {
    let values = this.exact.get(field);
    if (values === undefined) {
      values = field === "content" ? this.contentValue() : TEXT_SOURCES[field](this.facts);
      this.exact.set(field, values);
    }
    return values;
  }

  /** content = subject + body；两者已归一化，用空格拼接后仍是归一化形式 */
  private contentValue(): string[] {
    const subject = this.exactValues("subject")[0] ?? "";
    const body = this.exactValues("body")[0] ?? "";
    return [`${subject} ${body}`.trim()];
  }
}
