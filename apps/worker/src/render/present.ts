import {
  normalizeText,
  wrapMailHtmlDocument,
  type ExtractedValues,
  type PresentConfig,
  type PresentedMail,
  type ViewMode,
} from "@maillink/shared";
import type { CompiledPresentation } from "../rules/compile";
import type { MailFacts } from "../mail-parse/facts";
import { sanitizeEmailHtml } from "./html-sanitize";
import { maskAddress } from "./mask";
import { makeSnippet, normalizeDisplayText, processText } from "./text";

// 呈现（02 §4.1–§4.4，04 PresentedMail）：按视图模式与字段可见性裁剪，被隐藏的字段不出现在对象里。
// 只应对求值结果为可见的邮件调用；code_only 视图下没有可显示的提取结果说明调用方漏判了 no_code，直接抛错。

type ViewShape = { subject: boolean; snippet: boolean; attachments: boolean; extract: boolean; detail: boolean };

const VIEW_SHAPES: Readonly<Record<ViewMode, ViewShape>> = {
  full: { subject: true, snippet: true, attachments: true, extract: false, detail: true },
  text: { subject: true, snippet: true, attachments: true, extract: false, detail: true },
  code_only: { subject: false, snippet: false, attachments: false, extract: true, detail: false },
  meta_only: { subject: true, snippet: false, attachments: false, extract: false, detail: false },
};

/** code_only / meta_only 没有详情（详情接口应返回 404） */
export function viewHasDetail(view: ViewMode): boolean {
  return VIEW_SHAPES[view].detail;
}

export function presentListItem(
  presentation: CompiledPresentation,
  facts: MailFacts,
  extracted: ExtractedValues,
): PresentedMail {
  const { config } = presentation;
  const shape = VIEW_SHAPES[config.view];
  const mail: PresentedMail = { id: facts.mail_id, received_at: facts.received_at };
  const sender = SENDER_PRESENTERS[config.sender](senderParts(facts));
  if (sender !== null) mail.sender = sender;
  const recipient = presentRecipient(config.recipient, facts.recipient);
  if (recipient !== null) mail.recipient = recipient;
  if (shape.subject) mail.subject = processText(normalizeText(facts.subject), presentation, facts.links, "subject");
  if (shape.snippet && config.snippet) {
    mail.snippet = makeSnippet(processText(normalizeText(facts.body), presentation, facts.links, "body"));
  }
  const attachments = shape.attachments ? presentAttachments(config.attachments, facts.attachments) : null;
  if (attachments !== null) mail.attachments = attachments;
  if (shape.extract) Object.assign(mail, presentExtraction(config, extracted, facts.mail_id));
  return mail;
}

function presentRecipient(mode: PresentConfig["recipient"], recipient: string): string | null {
  if (mode === "full") return recipient;
  return mode === "masked" ? maskAddress(recipient) : null;
}

function presentAttachments(
  mode: PresentConfig["attachments"],
  attachments: MailFacts["attachments"],
): NonNullable<PresentedMail["attachments"]> | null {
  if (mode === "hidden" || attachments.length === 0) return null;
  const downloadable = mode === "download";
  return attachments.map((a, index) => ({ index, name: a.name, size: a.size, downloadable }));
}

/** 详情的正文来源：重新解析完整原文得到的纯文本与 HTML（M2 提供），不是 mail_index 里可能被截断的 body */
export type DetailContent = { text: string; html: string | null };

export async function presentDetail(
  presentation: CompiledPresentation,
  facts: MailFacts,
  extracted: ExtractedValues,
  content: DetailContent,
): Promise<PresentedMail> {
  const { config } = presentation;
  if (!viewHasDetail(config.view)) throw new Error(`视图 ${config.view} 没有详情`);
  const mail = presentListItem(presentation, facts, extracted);
  mail.text = processText(normalizeDisplayText(content.text), presentation, facts.links, "body");
  if (config.view === "full" && content.html !== null) {
    const sanitized = await sanitizeEmailHtml(content.html, {
      links: config.links,
      allowDomains: presentation.allowDomains,
      remoteImages: config.remote_images,
    });
    mail.html = wrapMailHtmlDocument(sanitized, config.remote_images);
  }
  return mail;
}

/** click 取码方式下尚未显示的邮件：只留 id、时间、发件人与收件地址（按原裁剪），不含主题、预览、验证码、链接、附件 */
export function lockPresentedMail(mail: PresentedMail): PresentedMail {
  const locked: PresentedMail = { id: mail.id, received_at: mail.received_at, locked: true };
  if (mail.sender !== undefined) locked.sender = mail.sender;
  if (mail.recipient !== undefined) locked.recipient = mail.recipient;
  return locked;
}

type SenderParts = { address: string | null; domain: string | null; name: string | null };
type PresentedSender = NonNullable<PresentedMail["sender"]>;

/** 展示用 addresses[0]（M2 负责把适合展示的候选放在第一个） */
function senderParts(facts: MailFacts): SenderParts {
  const address = facts.sender.addresses[0] ?? null;
  const fromAddress = address === null ? null : address.slice(address.lastIndexOf("@") + 1);
  const domain = fromAddress !== null && fromAddress !== "" ? fromAddress : (facts.sender.domains[0] ?? null);
  const name = facts.sender.name !== null && facts.sender.name !== "" ? facts.sender.name : null;
  return { address, domain, name };
}

const SENDER_PRESENTERS: Readonly<Record<PresentConfig["sender"], (parts: SenderParts) => PresentedSender | null>> = {
  full: ({ address, name }) => {
    if (address === null && name === null) return null;
    return { ...(address === null ? {} : { address }), ...(name === null ? {} : { name }) };
  },
  domain: ({ domain }) => (domain === null ? null : { domain }),
  name: ({ name }) => (name === null ? null : { name }),
  hidden: () => null,
};

function presentExtraction(
  config: PresentConfig,
  extracted: ExtractedValues,
  mailId: number,
): Pick<PresentedMail, "code" | "login_link"> {
  const result: Pick<PresentedMail, "code" | "login_link"> = {};
  if (config.extract.includes("code") && extracted.code !== null) result.code = extracted.code;
  if (config.extract.includes("login_link") && extracted.login_link !== null) result.login_link = extracted.login_link;
  if (result.code === undefined && result.login_link === undefined) {
    throw new Error(`mail ${mailId}: code_only 视图下没有可显示的提取结果，应在求值时判为 no_code`);
  }
  return result;
}
