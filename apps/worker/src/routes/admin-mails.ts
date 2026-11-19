import { Hono } from "hono";
import { z } from "zod";
import { adminMailListQuerySchema } from "@maillink/shared";
import type {
  AdminMailDetail,
  AdminMailListQuery,
  AdminMailListItem,
  AdminMailListResponse,
  CodeSource,
} from "@maillink/shared";
import { LIST_PAGE_SIZE } from "../constants";
import { listImportedAddresses } from "../db/imported-addresses";
import type { AppEnv } from "../env";
import { ApiError, notFoundError } from "../errors";
import { HTTP_OK, HTTP_UNPROCESSABLE } from "../http-status";
import { getOrBuild } from "../mail-index";
import type { IndexedItem } from "../mail-index";
import { MailParseError, parseMail, parseMime, visibleAttachments } from "../mail-parse";
import type { ParsedMail } from "../mail-parse";
import { getCandidateById, getRawBatch, listAdminMails } from "../mail-source";
import type { AdminMailFilters, MailCandidate, RawMailResult } from "../mail-source";
import { parseIdParam, parseQuery, parseWith } from "../validate";
import { attachmentDisposition } from "./content-disposition";

// 管理员"全部邮件"。鉴权由 index.ts 对 /api/admin/* 统一挂载的 requireAdmin 保证。

export const adminMailRoutes = new Hono<AppEnv>();

// 邮件相关响应一律不缓存（04 约定）
adminMailRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

/** 非 ok 状态（failed / pending）的列表项：内容字段全部为空 */
const FAILED_ITEM = { sender: null, subject: null, has_attachment: null, code: null, category: null } as const;

function toListItem(item: IndexedItem): AdminMailListItem {
  const { candidate } = item;
  const base = {
    id: candidate.id,
    received_at: candidate.received_at,
    recipient: candidate.recipient,
    envelope: candidate.source,
  };
  if (item.status !== "ok") return { ...base, ...FAILED_ITEM, parse_status: item.status };
  const { facts, row } = item;
  const hasSender = row.from_address !== null || facts.sender.name !== null;
  return {
    ...base,
    parse_status: "ok",
    sender: hasSender ? { address: row.from_address, name: facts.sender.name } : null,
    subject: facts.subject,
    has_attachment: facts.attachments.length > 0,
    code: facts.code,
    category: facts.category,
  };
}

async function loadImportedAddresses(db: D1Database, scope: string): Promise<string[] | undefined> {
  return scope === "all" ? undefined : await listImportedAddresses(db);
}

function buildFilters(query: AdminMailListQuery, limit: number, importedAddresses: string[] | undefined): AdminMailFilters {
  return {
    scope: query.scope,
    importedAddresses,
    address: query.address,
    toAddress: query.to_address,
    source: query.source,
    since: query.since,
    until: query.until,
    beforeId: query.cursor === undefined ? undefined : Number(query.cursor),
    afterId: query.after_id,
    limit,
  };
}

// 增量轮询的约定：响应 partial=true 时调用方不能推进 after_id（pending 的邮件 id 可能小于已就绪的，推进后会永远漏掉），
// 应稍后用同一个 after_id 重取，直到 partial=false。
adminMailRoutes.get("/", async (c) => {
  const query = parseQuery(c, adminMailListQuerySchema);
  const limit = query.limit ?? LIST_PAGE_SIZE;
  const incremental = query.after_id !== undefined;
  const importedAddresses = await loadImportedAddresses(c.env.APP_DB, query.scope);
  // 翻页多取一行，用来判断还有没有下一页；增量轮询不翻页
  const rows = await listAdminMails(c.env.MAIL_DB, buildFilters(query, incremental ? limit : limit + 1, importedAddresses));
  const hasMore = !incremental && rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const { items, partial } = await getOrBuild(c.env, page);
  // 增量轮询按 id 正序取（一次取不完时能从最大的 id 接着取），展示时统一成新的在前
  const ordered = incremental ? items.toReversed() : items;
  const last = page.at(-1);
  const body: AdminMailListResponse = {
    items: ordered.map(toListItem),
    next_cursor: hasMore && last ? String(last.id) : null,
    partial,
  };
  return c.json(body, HTTP_OK);
});

const detailQuerySchema = z.object({ raw: z.enum(["0", "1"]).optional() });

type DetailParts = { parsed: ParsedMail | null; error: string | null };

async function tryParse(candidate: MailCandidate, result: RawMailResult): Promise<DetailParts> {
  if (!result.ok) return { parsed: null, error: result.error };
  try {
    const input = { candidate, raw: result.raw, metadata: result.metadata };
    return { parsed: await parseMail(input), error: null };
  } catch (error) {
    // 只有"邮件本身不可解析"才展示为解析失败；其他异常是代码缺陷，直接抛出
    if (!(error instanceof MailParseError)) throw error;
    return { parsed: null, error: error.message };
  }
}

function toDetailParsed(parsed: ParsedMail): NonNullable<AdminMailDetail["parsed"]> {
  const { facts } = parsed;
  return {
    subject: facts.subject,
    from: { address: parsed.from_address, name: facts.sender.name },
    sender_candidates: { addresses: facts.sender.addresses, domains: facts.sender.domains },
    // 展示用正文（保留换行），不是判定用的 facts.body
    body: parsed.display_body,
    body_truncated: parsed.display_truncated,
    links: facts.links,
    attachments: facts.attachments.map((attachment, index) => ({ index, ...attachment })),
    code: facts.code,
    code_source: parsed.code_source satisfies CodeSource | null,
    category: facts.category,
    headers: parsed.headers,
    // TODO(M3b): 清洗器（render/）接上后在这里开放 HTML 正文；本里程碑只告知有 HTML
    has_html: facts.has_html,
  };
}

adminMailRoutes.get("/:id", async (c) => {
  const id = parseIdParam(c);
  const { raw: rawFlag } = parseQuery(c, detailQuerySchema);
  const candidate = await getCandidateById(c.env.MAIL_DB, id);
  const result = (await getRawBatch(c.env.MAIL_DB, [id]))[0];
  if (!candidate || !result) throw notFoundError("邮件不存在");

  const { parsed, error } = await tryParse(candidate, result);
  const body: AdminMailDetail = {
    id,
    received_at: candidate.received_at,
    recipient: candidate.recipient,
    envelope: { source: candidate.source, address: candidate.address, to_address: candidate.to_address },
    parse_status: parsed ? "ok" : "failed",
    parse_error: error,
    raw_size: parsed?.facts.raw_size ?? null,
    parsed: parsed ? toDetailParsed(parsed) : null,
    // 解析失败的邮件仍可看原文（只要原文本身取得到）
    ...(rawFlag === "1" && result.ok && { raw: result.raw }),
  };
  return c.json(body, HTTP_OK);
});

const attachmentParamsSchema = z.object({ index: z.coerce.number().int().nonnegative() });

adminMailRoutes.get("/:id/attachments/:index", async (c) => {
  const id = parseIdParam(c);
  const { index } = parseWith(attachmentParamsSchema, { index: c.req.param("index") });
  const result = (await getRawBatch(c.env.MAIL_DB, [id]))[0];
  if (!result) throw notFoundError("邮件不存在");
  if (!result.ok) throw new ApiError(HTTP_UNPROCESSABLE, "mail_unreadable", result.error);

  const email = await parseMime(result.raw).catch((error: unknown) => {
    throw new ApiError(HTTP_UNPROCESSABLE, "mail_parse_failed", error instanceof Error ? error.message : String(error));
  });
  const attachment = visibleAttachments(email)[index];
  if (!attachment) throw notFoundError("附件不存在");

  const content =
    typeof attachment.content === "string" ? new TextEncoder().encode(attachment.content) : new Uint8Array(attachment.content);
  return new Response(content, {
    status: HTTP_OK,
    headers: {
      // 不信任邮件里声明的类型：一律当二进制下载，并禁止浏览器嗅探
      "Content-Type": "application/octet-stream",
      "Content-Disposition": attachmentDisposition(attachment.filename ?? "", `attachment-${index}`),
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(content.byteLength),
    },
  });
});
