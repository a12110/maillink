// 规则引擎的输入。MailFacts 的唯一定义在 mail-parse/facts.ts（类型导入，rules 仍是无 IO 的纯函数）。
import type { CodeSource, MailFacts } from "../mail-parse/facts";

export type { CodeSource, MailCategory, MailFacts } from "../mail-parse/facts";

/** 求值入口的输入：解析失败的邮件没有 MailFacts */
export type EvaluationInput =
  | { kind: "ok"; facts: MailFacts; code_source: CodeSource | null }
  | { kind: "failed"; mail_id: number; received_at: number };
