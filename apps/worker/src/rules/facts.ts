// 规则引擎的输入。MailFacts 与 M2（mail-parse）产出的对象结构完全相同，M3b 合并时去重。

export type MailCategory = 'email_change' | 'password_reset' | 'security_change' | 'billing' | 'verification' | 'other';
export type MailFacts = {
  mail_id: number;
  received_at: number;            // Unix 秒，来自 raw_mails.created_at
  recipient: string;              // 全小写
  sender: {
    addresses: string[];          // 候选：From + 符合条件的 HME s=；全小写、去重
    domains: string[];            // 候选地址的域名；全小写、去重
    name: string | null;          // From 显示名
    envelope: string | null;      // raw_mails.source
  };
  subject: string;                // 解码后、已按 01 §4.1 归一化
  body: string;                   // text/plain + html→text 拼接后归一化；可能被截断
  body_truncated: boolean;
  links: string[];                // 正文 URL，去重
  link_domains: string[];         // 由 links 派生，全小写
  attachments: Array<{ name: string; content_type: string; size: number }>;
  code: string | null;            // ai_extract(auth_code) → 内置提取，可为空
  category: MailCategory;
  raw_size: number;
  has_html: boolean;
};

/** facts.code 的来源（M2 记在 mail_index 里）；facts.code 为 null 时必须为 null */
export type CodeSource = "ai_extract" | "builtin";

/** 求值入口的输入：解析失败的邮件没有 MailFacts */
export type EvaluationInput =
  | { kind: "ok"; facts: MailFacts; code_source: CodeSource | null }
  | { kind: "failed"; mail_id: number; received_at: number };
