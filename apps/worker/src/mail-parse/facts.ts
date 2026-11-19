import { z } from "zod";
import { MAIL_CATEGORIES } from "@maillink/shared";
import type { CodeSource } from "@maillink/shared";

// MailFacts 与 M3a（rules/）共用的对接类型：两边定义必须逐字一致，M3b 合并时去重。

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

// 编译期检查：本文件的 MailCategory 与 shared 里的枚举一致
type SharedCategory = (typeof MAIL_CATEGORIES)[number];
const _categoryMatchesShared: [MailCategory] extends [SharedCategory]
  ? [SharedCategory] extends [MailCategory]
    ? true
    : never
  : never = true;
void _categoryMatchesShared;

export type { CodeSource };

/** mail_index 的一行（01 §5 + 0003 迁移），JSON 列保持文本形态 */
export type MailIndexRow = {
  mail_id: number;
  message_id: string | null;
  received_at: number;
  recipient: string;
  /** JSON 数组：发件人候选地址（全小写） */
  sender_address: string | null;
  /** JSON 数组：候选地址的域名 */
  sender_domain: string | null;
  sender_name: string | null;
  sender_envelope: string | null;
  /** From 头地址（0003）：列表里"展示用发件人" */
  from_address: string | null;
  subject: string | null;
  body_text: string | null;
  body_truncated: number;
  /** JSON 数组（受数量与长度上限约束） */
  links: string | null;
  /** JSON 数组（0003）：全部可解析链接的域名，不受 links 上限影响 */
  link_domains: string | null;
  /** JSON 数组：{ name, content_type, size } */
  attachments: string | null;
  code: string | null;
  /** 验证码来源（0003）：ai_extract / builtin；没有验证码时为 null */
  code_source: CodeSource | null;
  category: string | null;
  raw_size: number | null;
  has_html: number | null;
  parse_status: "ok" | "failed";
  parse_error: string | null;
  parser_version: number;
  indexed_at: number;
};

const stringArraySchema = z.array(z.string());
const attachmentArraySchema = z.array(
  z.object({ name: z.string(), content_type: z.string(), size: z.number().int() }),
);

function readJson<S extends z.ZodType>(schema: S, text: string | null, column: string, mailId: number): z.output<S> {
  try {
    return schema.parse(JSON.parse(text ?? "[]"));
  } catch (error) {
    // 索引行被改坏：暴露出来，不当作空数组处理
    throw new Error(`mail_index.${column} 内容无效 (mail_id=${mailId})`, { cause: error });
  }
}

/**
 * mail_index 行 → MailFacts（M3a 的规则引擎从这里取事实）。
 * parse_status 为 failed 的行没有可用事实：直接抛错，不返回空 facts
 * （空 facts 在黑名单模式下不命中任何 deny，会失败开放，见 02 §5）。
 */
export function rowToFacts(row: MailIndexRow): MailFacts {
  if (row.parse_status !== "ok") {
    throw new Error(`mail_index 行解析失败，没有可用事实 (mail_id=${row.mail_id}): ${row.parse_error ?? "未知原因"}`);
  }
  if (row.link_domains === null) {
    // 旧版解析器写的行没有这一列；版本号不符会被重建，走到这里说明有行绕过了版本检查
    throw new Error(`mail_index.link_domains 为空 (mail_id=${row.mail_id})，行需要重建`);
  }
  const links = readJson(stringArraySchema, row.links, "links", row.mail_id);
  return {
    mail_id: row.mail_id,
    received_at: row.received_at,
    recipient: row.recipient,
    sender: {
      addresses: readJson(stringArraySchema, row.sender_address, "sender_address", row.mail_id),
      domains: readJson(stringArraySchema, row.sender_domain, "sender_domain", row.mail_id),
      name: row.sender_name,
      envelope: row.sender_envelope,
    },
    subject: row.subject ?? "",
    body: row.body_text ?? "",
    body_truncated: row.body_truncated === 1,
    links,
    link_domains: readJson(stringArraySchema, row.link_domains, "link_domains", row.mail_id),
    attachments: readJson(attachmentArraySchema, row.attachments, "attachments", row.mail_id),
    code: row.code,
    category: parseCategory(row),
    raw_size: row.raw_size ?? 0,
    has_html: row.has_html === 1,
  };
}

function parseCategory(row: MailIndexRow): MailCategory {
  if (row.category === null) return "other";
  const parsed = z.enum(MAIL_CATEGORIES).safeParse(row.category);
  if (!parsed.success) throw new Error(`mail_index.category 内容无效 (mail_id=${row.mail_id}): ${row.category}`);
  return parsed.data;
}
