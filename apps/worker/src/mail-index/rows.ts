import { PARSE_ERROR_MAX_LENGTH, PARSER_VERSION } from "../constants";
import type { MailCandidate } from "../mail-source";
import { truncateChars } from "../text-utils";
import type { MailIndexRow } from "../mail-parse";
import type { ParsedMail } from "../mail-parse";

// mail_index 的行构造与读写（APP_DB，全部参数化）。
// 发件人候选存在原有的 sender_address / sender_domain 两列，内容是 JSON 数组；
// from_address 与 code_source 是 0003 迁移新增的列。

const COLUMNS = [
  "mail_id", "message_id", "received_at", "recipient", "sender_address", "sender_domain", "sender_name",
  "sender_envelope", "from_address", "subject", "body_text", "body_truncated", "links", "link_domains", "attachments", "code",
  "code_source", "category", "raw_size", "has_html", "parse_status", "parse_error", "parser_version", "indexed_at",
] as const satisfies ReadonlyArray<keyof MailIndexRow>;

const UPSERT_SQL = `INSERT INTO mail_index (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map((_, i) => `?${i + 1}`).join(", ")}) ON CONFLICT(mail_id) DO UPDATE SET ${COLUMNS.filter((c) => c !== "mail_id")
  .map((c) => `${c} = excluded.${c}`)
  .join(", ")}`;

export function buildOkRow(candidate: MailCandidate, parsed: ParsedMail, now: number): MailIndexRow {
  const { facts } = parsed;
  return {
    mail_id: candidate.id,
    message_id: candidate.message_id,
    received_at: candidate.received_at,
    recipient: candidate.recipient,
    sender_address: JSON.stringify(facts.sender.addresses),
    sender_domain: JSON.stringify(facts.sender.domains),
    sender_name: facts.sender.name,
    sender_envelope: facts.sender.envelope,
    from_address: parsed.from_address,
    subject: facts.subject,
    body_text: facts.body,
    body_truncated: facts.body_truncated ? 1 : 0,
    links: JSON.stringify(facts.links),
    link_domains: JSON.stringify(facts.link_domains),
    attachments: JSON.stringify(facts.attachments),
    code: facts.code,
    code_source: parsed.code_source,
    category: facts.category,
    raw_size: facts.raw_size,
    has_html: facts.has_html ? 1 : 0,
    parse_status: "ok",
    parse_error: null,
    parser_version: PARSER_VERSION,
    indexed_at: now,
  };
}

/** 解析失败的行：保留候选里的元数据，内容字段为空；错误信息写进 parse_error */
export function buildFailedRow(candidate: MailCandidate, error: string, now: number): MailIndexRow {
  return {
    mail_id: candidate.id,
    message_id: candidate.message_id,
    received_at: candidate.received_at,
    recipient: candidate.recipient,
    sender_address: "[]",
    sender_domain: "[]",
    sender_name: null,
    sender_envelope: candidate.source,
    from_address: null,
    subject: null,
    body_text: null,
    body_truncated: 0,
    links: "[]",
    link_domains: "[]",
    attachments: "[]",
    code: null,
    code_source: null,
    category: null,
    raw_size: null,
    has_html: null,
    parse_status: "failed",
    parse_error: truncateChars(error, PARSE_ERROR_MAX_LENGTH),
    parser_version: PARSER_VERSION,
    indexed_at: now,
  };
}

export async function findIndexRows(db: D1Database, ids: readonly number[]): Promise<Map<number, MailIndexRow>> {
  if (ids.length === 0) return new Map();
  const { results } = await db
    .prepare(`SELECT ${COLUMNS.join(", ")} FROM mail_index WHERE mail_id IN (SELECT value FROM json_each(?1))`)
    .bind(JSON.stringify(ids))
    .all<MailIndexRow>();
  return new Map(results.map((row) => [row.mail_id, row]));
}

export async function upsertIndexRows(db: D1Database, rows: readonly MailIndexRow[]): Promise<void> {
  if (rows.length === 0) return;
  const statements = rows.map((row) => db.prepare(UPSERT_SQL).bind(...COLUMNS.map((column) => row[column])));
  await db.batch(statements);
}
