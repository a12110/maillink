import PostalMime from "postal-mime";
import type { Address, Attachment, Email } from "postal-mime";
import {
  ADMIN_DETAIL_BODY_CAP_BYTES,
  BODY_INDEX_CAP_BYTES,
  MAIL_PARSE_MAX_NESTING_DEPTH,
  MAIL_PARSE_MAX_PART_COUNT,
} from "../constants";
import type { MailCandidate } from "../mail-source";
import { classifyMail } from "./category";
import { resolveCode } from "./code-extract";
import type { CodeSource, MailFacts } from "./facts";
import { hmeSender } from "./hme";
import { extractHtml } from "./html-text";
import { extractLinks } from "./links";
import { normalizeDisplayText, normalizeText, truncateUtf8 } from "./normalize";

/** 邮件原文不是可识别的 RFC 5322 报文（解析器抛错，或根本没有邮件头） */
export class MailParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MailParseError";
  }
}

export type ParseInput = {
  candidate: MailCandidate;
  /** 邮件原文（已解 gzip） */
  raw: string;
  /** raw_mails.metadata 的 JSON 原文 */
  metadata: string | null;
};

export type ParsedMail = {
  facts: MailFacts;
  /** From 头地址（全小写）；展示用发件人 */
  from_address: string | null;
  code_source: CodeSource | null;
  /** 展示用正文（保留换行），上限 ADMIN_DETAIL_BODY_CAP_BYTES；不写进索引，不用于规则判定 */
  display_body: string;
  display_truncated: boolean;
  headers: Array<{ key: string; value: string }>;
};

/** 用 postal-mime 解析原文；失败或没有任何邮件头时抛 MailParseError */
export async function parseMime(raw: string): Promise<Email> {
  let email: Email;
  try {
    email = await PostalMime.parse(raw, {
      maxNestingDepth: MAIL_PARSE_MAX_NESTING_DEPTH,
      maxPartCount: MAIL_PARSE_MAX_PART_COUNT,
    });
  } catch (error) {
    throw new MailParseError(`邮件解析失败：${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  if (email.headers.length === 0) throw new MailParseError("邮件原文里没有识别到任何邮件头");
  return email;
}

/**
 * 列为"附件"的部分：排除被 HTML 用 cid 引用的内嵌资源（related）。
 * 附件下载接口用同一个函数取下标，保证列表与下载的 index 一致。
 */
export function visibleAttachments(email: Email): Attachment[] {
  return email.attachments.filter((attachment) => attachment.related !== true);
}

export function attachmentSize(attachment: Attachment): number {
  const { content } = attachment;
  return typeof content === "string" ? new TextEncoder().encode(content).length : content.byteLength;
}

/** From 头里的第一个邮箱地址（地址组取第一个成员） */
function fromMailbox(from: Address | undefined): { address: string | null; name: string | null } {
  const mailbox = from?.group ? from.group[0] : from;
  const address = mailbox?.address?.trim().toLowerCase() || null;
  const name = mailbox?.name ? normalizeText(mailbox.name) : "";
  return { address, name: name || null };
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1);
}

function senderCandidates(email: Email, recipient: string, fromAddress: string | null): string[] {
  const addresses = new Set<string>();
  if (fromAddress) addresses.add(fromAddress);
  const hme = hmeSender(email.headers, recipient);
  if (hme) addresses.add(hme);
  return [...addresses];
}

type BodyParts = {
  /** 判定用：单行归一化文本 */
  body: string;
  /** 展示用：保留换行 */
  display: string;
  hrefs: string[];
};

/** text/plain 与 html→text 两者拼接。内容相同（常见的 multipart/alternative）时只保留一份 */
async function buildBody(email: Email): Promise<BodyParts> {
  const plain = email.text ?? "";
  const html = email.html ? await extractHtml(email.html) : { text: "", hrefs: [] };
  const plainBody = normalizeText(plain);
  const htmlBody = normalizeText(html.text);
  const sameContent = htmlBody === plainBody;
  const bodies = [plainBody, sameContent ? "" : htmlBody];
  const displays = [normalizeDisplayText(plain), sameContent ? "" : normalizeDisplayText(html.text)];
  return {
    body: bodies.filter((part) => part.length > 0).join(" "),
    display: displays.filter((part) => part.length > 0).join("\n\n"),
    hrefs: html.hrefs,
  };
}

export async function parseMail(input: ParseInput): Promise<ParsedMail> {
  const { candidate, raw, metadata } = input;
  const email = await parseMime(raw);
  const recipient = candidate.recipient;
  const from = fromMailbox(email.from);
  const addresses = senderCandidates(email, recipient, from.address);

  const subject = normalizeText(email.subject ?? "");
  const { body: fullBody, display, hrefs } = await buildBody(email);
  const { links, domains: linkHosts } = extractLinks(fullBody, hrefs);
  const { code, source } = resolveCode(subject, fullBody, metadata);
  // 提取与分类都用完整正文；截断只影响存进索引与返回的副本
  const category = classifyMail({ subject, body: fullBody, code, links });
  const { text: body, truncated } = truncateUtf8(fullBody, BODY_INDEX_CAP_BYTES);
  const displayBody = truncateUtf8(display, ADMIN_DETAIL_BODY_CAP_BYTES);

  return {
    facts: {
      mail_id: candidate.id,
      received_at: candidate.received_at,
      recipient,
      sender: {
        addresses,
        domains: [...new Set(addresses.map(domainOf))],
        name: from.name,
        envelope: candidate.source,
      },
      subject,
      body,
      body_truncated: truncated,
      links,
      link_domains: linkHosts,
      attachments: visibleAttachments(email).map((attachment) => ({
        name: attachment.filename ?? "",
        content_type: attachment.mimeType,
        size: attachmentSize(attachment),
      })),
      code,
      category,
      raw_size: new TextEncoder().encode(raw).length,
      has_html: Boolean(email.html),
    },
    from_address: from.address,
    code_source: source,
    display_body: displayBody.text,
    display_truncated: displayBody.truncated,
    headers: email.headers.map((header) => ({ key: header.originalKey, value: header.value })),
  };
}
