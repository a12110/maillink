import type { ExtractedValues, PresentedMail } from "@maillink/shared";
import { notFoundError } from "../errors";
import { mailIdentity, type MailIdentity, type MailIndexDbs } from "../mail-index";
import { MailParseError, parseMail, parseMime, visibleAttachments, type ParsedMail } from "../mail-parse";
import { expandAddressForms, getCandidateById, getRawBatch, type MailCandidate } from "../mail-source";
import { HtmlSanitizeError, presentDetail, viewHasDetail } from "../render";
import { evaluate, isWithinWindow, type CompiledPresentation, type CompiledRuleGroup } from "../rules";
import { effectivePolicy, type AccessScope } from "./policy";
import { scanNewestVisible } from "./newest";

// 详情与附件（02 §5）：每次都重新走完整流水线——地址归属 + 时间下界 + 重新解析原文（不信任索引）再判一次规则 + max_mails，
// 不因为"这个 id 在列表里出现过"就放行。任一不通过都是同一个 404，不区分原因（防探测）。

export type DetailOptions = {
  now: number;
  /** 只对管理员作用域生效：?remote_images=allow；链接与授权一律按规则组配置 */
  remoteImages?: "block" | "allow";
  /**
   * 调用方附加的放行条件，拿 MAIL_DB 里当前这封的身份判定（取件链接 click 模式："这封已交付给本链接"）。
   * 与渲染用的是同一次取到的候选，id 在中途被新邮件复用也不会错放；返回 false 同样 404。
   */
  gate?: (mail: MailIdentity) => Promise<boolean>;
};

type VisibleMail = {
  compiled: CompiledRuleGroup;
  parsed: ParsedMail;
  extracted: ExtractedValues;
  raw: string;
};

const hidden = () => notFoundError("邮件不存在");

/** 与 candidates.ts 的 SQL 口径一致：to_address 非空时按它匹配，否则按 address；每个地址只认两种写法 */
function belongsToScope(candidate: MailCandidate, addresses: readonly string[]): boolean {
  const recipient = candidate.to_address || candidate.address;
  return expandAddressForms(addresses).includes(recipient);
}

/**
 * 重新解析原文（不信任 mail_index）。判定用正文仍截到 BODY_INDEX_CAP_BYTES（与索引、列表同一口径）：
 * 管理员写的正则只在有上限的文本上运行（02 §7 回溯防线），截断时按 02 §3.5 由 evaluate 判 body_truncated。
 */
async function parseForDetail(candidate: MailCandidate, raw: string, metadata: string | null): Promise<ParsedMail | null> {
  try {
    return await parseMail({ candidate, raw, metadata });
  } catch (error) {
    if (!(error instanceof MailParseError)) throw error;
    return null;
  }
}

/**
 * max_mails：只有"首页 N 封"（scanNewestVisible，与列表同一函数）里的邮件可见。
 * 扫描遇到未就绪的邮件时，不在已确定的 N 封里就按不可见处理（失败关闭）。
 */
async function withinMaxMails(dbs: MailIndexDbs, scope: AccessScope, compiled: CompiledRuleGroup, lowerBound: number | null, mailId: number): Promise<boolean> {
  const maxMails = compiled.config.limits.max_mails;
  if (maxMails === undefined) return true;
  const { entries } = await scanNewestVisible(dbs, scope.addresses, compiled, lowerBound, maxMails);
  return entries.some((entry) => entry.mail_id === mailId);
}

/** 地址归属与时间下界：只看候选元数据，不取正文 */
async function locateCandidate(dbs: MailIndexDbs, scope: AccessScope, mailId: number, lowerBound: number | null): Promise<MailCandidate> {
  const candidate = await getCandidateById(dbs.MAIL_DB, mailId);
  if (!candidate || !belongsToScope(candidate, scope.addresses) || !isWithinWindow(candidate.received_at, lowerBound)) {
    throw hidden();
  }
  return candidate;
}

async function resolveVisibleMail(
  dbs: MailIndexDbs,
  scope: AccessScope,
  mailId: number,
  options: Pick<DetailOptions, "now" | "gate">,
): Promise<VisibleMail> {
  const { compiled, lowerBound } = effectivePolicy(scope, options.now);
  const candidate = await locateCandidate(dbs, scope, mailId, lowerBound);
  if (options.gate !== undefined && !(await options.gate(mailIdentity(candidate)))) throw hidden();
  const raw = (await getRawBatch(dbs.MAIL_DB, [mailId]))[0];
  if (!raw?.ok) throw hidden();
  const parsed = await parseForDetail(candidate, raw.raw, raw.metadata);
  if (parsed === null) throw hidden();
  const evaluation = evaluate(
    compiled,
    { kind: "ok", facts: parsed.facts, code_source: parsed.code_source },
    { time_lower_bound: lowerBound },
  );
  if (!evaluation.visible || evaluation.extracted === null || !viewHasDetail(compiled.config.present.view)) throw hidden();
  if (!(await withinMaxMails(dbs, scope, compiled, lowerBound, mailId))) throw hidden();
  return { compiled, parsed, extracted: evaluation.extracted, raw: raw.raw };
}

function detailPresentation(scope: AccessScope, compiled: CompiledRuleGroup, options: DetailOptions): CompiledPresentation {
  const base = compiled.presentation;
  if (scope.policy !== null || options.remoteImages === undefined) return base;
  return { ...base, config: { ...base.config, remote_images: options.remoteImages } };
}

export async function getVisibleMailDetail(
  dbs: MailIndexDbs,
  scope: AccessScope,
  mailId: number,
  options: DetailOptions,
): Promise<PresentedMail> {
  const { compiled, parsed, extracted } = await resolveVisibleMail(dbs, scope, mailId, options);
  const presentation = detailPresentation(scope, compiled, options);
  const content = { text: parsed.display_body, html: parsed.html };
  try {
    return await presentDetail(presentation, parsed.facts, extracted, content);
  } catch (error) {
    if (!(error instanceof HtmlSanitizeError)) throw error;
    // 清洗失败：只给纯文本，绝不回退原始 HTML（PLAN"邮件 HTML 展示的硬性要求"第 2 条）
    console.error(`mail ${mailId}: HTML 清洗失败，降级为纯文本`, error);
    return await presentDetail(presentation, parsed.facts, extracted, { ...content, html: null });
  }
}

export type VisibleAttachment = { filename: string; content: Uint8Array };

/** 附件下载：同样每次重走流水线，且规则组 attachments 必须是 download */
export async function getVisibleAttachment(
  dbs: MailIndexDbs,
  scope: AccessScope,
  mailId: number,
  index: number,
  options: Pick<DetailOptions, "now" | "gate">,
): Promise<VisibleAttachment> {
  const { compiled, raw } = await resolveVisibleMail(dbs, scope, mailId, options);
  if (compiled.config.present.attachments !== "download") throw hidden();
  const attachment = visibleAttachments(await parseMime(raw))[index];
  if (!attachment) throw notFoundError("附件不存在");
  const content =
    typeof attachment.content === "string" ? new TextEncoder().encode(attachment.content) : new Uint8Array(attachment.content);
  return { filename: attachment.filename ?? "", content };
}
