import { Hono } from "hono";
import {
  MAILBOX_LIMITS,
  adminMailboxListQuerySchema,
  mailboxBatchRequestSchema,
  mailboxImportRequestSchema,
  mailboxPatchSchema,
  type AdminMailbox,
  type AdminMailboxListResponse,
  type MailboxBatchRequest,
  type MailboxBatchResponse,
  type MailboxImportItem,
  type MailboxImportResponse,
  type OkResponse,
} from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { nowSec } from "../clock";
import {
  addMailboxTags,
  deleteMailboxes,
  findMailboxIdsByAddressLc,
  findMailboxRow,
  findMailboxRows,
  findMailboxTags,
  insertMailboxes,
  listMailboxRows,
  removeMailboxTags,
  setMailboxStatus,
  updateMailbox,
  type MailboxRow,
  type NewMailbox,
} from "../db/mailboxes";
import type { AppEnv } from "../env";
import { notFoundError } from "../errors";
import { HTTP_CREATED, HTTP_OK } from "../http-status";
import { getLastReceivedAt } from "../mail-source";
import { parseIdParam, parseJsonBody, parseQuery } from "../validate";
import { parseMailboxImport, type ImportLine } from "./mailbox-import-parse";

// 管理端"收件地址"（04 管理端 / 收件地址）。鉴权由 index.ts 对 /api/admin/* 统一挂载的 requireAdmin 保证。

export const adminMailboxRoutes = new Hono<AppEnv>();

// 列表带最近来信时间，导入与批量结果带地址；一律不缓存
adminMailboxRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

function toAdminMailbox(row: MailboxRow, lastReceived: Map<string, number | null>): AdminMailbox {
  return {
    id: row.id,
    address: row.address,
    label: row.label,
    note: row.note,
    status: row.status,
    tags: JSON.parse(row.tags) as string[],
    link_count: row.link_count,
    grant_count: row.grant_count,
    last_received_at: lastReceived.get(row.address) ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

adminMailboxRoutes.get("/", async (c) => {
  const query = parseQuery(c, adminMailboxListQuerySchema);
  const { rows, next_cursor, total } = await listMailboxRows(c.env.APP_DB, query);
  const lastReceived = await getLastReceivedAt(c.env.MAIL_DB, rows.map((row) => row.address));
  const body: AdminMailboxListResponse = { items: rows.map((row) => toAdminMailbox(row, lastReceived)), next_cursor, total };
  return c.json(body, HTTP_OK);
});

/** 逐行判定：格式问题 → invalid；本次重复 / 已导入 → duplicate；其余 → new */
function classifyLines(lines: readonly ImportLine[], existing: Map<string, number>): MailboxImportItem[] {
  const seen = new Set<string>();
  return lines.map((line) => {
    const base = { line: line.line, input: line.input, address: line.address };
    if (line.error !== null || line.address_lc === null) return { ...base, status: "invalid", reason: line.error, id: null };
    const existingId = existing.get(line.address_lc);
    if (existingId !== undefined) return { ...base, status: "duplicate", reason: "already_exists", id: existingId };
    if (seen.has(line.address_lc)) return { ...base, status: "duplicate", reason: "duplicate_in_input", id: null };
    seen.add(line.address_lc);
    return { ...base, status: "new", reason: null, id: null };
  });
}

function summarize(items: readonly MailboxImportItem[]): MailboxImportResponse["summary"] {
  const count = (status: MailboxImportItem["status"]) => items.filter((item) => item.status === status).length;
  return { new: count("new"), duplicate: count("duplicate"), invalid: count("invalid") };
}

adminMailboxRoutes.post("/import", async (c) => {
  const db = c.env.APP_DB;
  const body = await parseJsonBody(c, mailboxImportRequestSchema);
  const lines = parseMailboxImport(body.content, body.tags);
  const addressesLc = lines.flatMap((line) => (line.address_lc === null ? [] : [line.address_lc]));
  const items = classifyLines(lines, await findMailboxIdsByAddressLc(db, addressesLc));
  if (body.dry_run) {
    const preview: MailboxImportResponse = { dry_run: true, summary: summarize(items), items };
    return c.json(preview, HTTP_OK);
  }

  const auth = c.get("auth");
  const fresh: NewMailbox[] = lines.flatMap((line, index) =>
    items[index]?.status === "new" && line.address !== null && line.address_lc !== null
      ? [{ address: line.address, address_lc: line.address_lc, note: line.note, tags: line.tags }]
      : [],
  );
  const inserted = await insertMailboxes(db, fresh, auth.user.id, nowSec());
  // 判定之后被并发导入抢先写入的地址：改记为 duplicate / already_exists，并回填已存在的 id
  const raced = await findMailboxIdsByAddressLc(db, fresh.filter((entry) => !inserted.has(entry.address_lc)).map((entry) => entry.address_lc));
  const written = items.map((item, index): MailboxImportItem => {
    const lc = lines[index]?.address_lc;
    if (item.status !== "new" || !lc) return item;
    const id = inserted.get(lc);
    if (id !== undefined) return { ...item, id };
    return { ...item, status: "duplicate", reason: "already_exists", id: raced.get(lc) ?? null };
  });
  const result: MailboxImportResponse = { dry_run: false, summary: summarize(written), items: written };
  await recordAudit(c, {
    action: AUDIT_ACTIONS.mailboxImport,
    actorUserId: auth.user.id,
    targetType: "mailbox",
    detail: { ...result.summary, addresses: fresh.filter((entry) => inserted.has(entry.address_lc)).map((entry) => entry.address) },
  });
  return c.json(result, HTTP_CREATED);
});

async function requireMailbox(db: D1Database, id: number): Promise<MailboxRow> {
  const row = await findMailboxRow(db, id);
  if (!row) throw notFoundError("收件地址不存在");
  return row;
}

adminMailboxRoutes.patch("/:id", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const patch = await parseJsonBody(c, mailboxPatchSchema);
  const before = await requireMailbox(db, id);
  if (!(await updateMailbox(db, id, patch, nowSec()))) throw notFoundError("收件地址不存在");
  const after = await requireMailbox(db, id);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.mailboxUpdate,
    actorUserId: c.get("auth").user.id,
    targetType: "mailbox",
    targetId: id,
    detail: {
      address: before.address,
      before: { label: before.label, note: before.note, status: before.status, tags: JSON.parse(before.tags) as string[] },
      patch,
    },
  });
  const lastReceived = await getLastReceivedAt(c.env.MAIL_DB, [after.address]);
  return c.json(toAdminMailbox(after, lastReceived), HTTP_OK);
});

adminMailboxRoutes.delete("/:id", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const before = await requireMailbox(db, id);
  if ((await deleteMailboxes(db, [id])).length === 0) throw notFoundError("收件地址不存在");
  await recordAudit(c, {
    action: AUDIT_ACTIONS.mailboxDelete,
    actorUserId: c.get("auth").user.id,
    targetType: "mailbox",
    targetId: id,
    // 链接与授权里的这个地址随外键级联删除，留下删除时的引用数
    detail: { address: before.address, link_count: before.link_count, grant_count: before.grant_count },
  });
  const ok: OkResponse = { status: "ok" };
  return c.json(ok, HTTP_OK);
});

type BatchResult = MailboxBatchResponse["results"][number];

async function addTagsBatch(db: D1Database, ids: number[], tags: string[], now: number): Promise<BatchResult[]> {
  const current = await findMailboxTags(db, ids);
  const pairs: Array<[number, string]> = [];
  const results = ids.map((id): BatchResult => {
    const existing = current.get(id);
    if (!existing) return { id, ok: false, error: "not_found" };
    const added = tags.filter((tag) => !existing.has(tag));
    if (existing.size + added.length > MAILBOX_LIMITS.tagsPerMailbox) return { id, ok: false, error: "too_many_tags" };
    pairs.push(...added.map((tag): [number, string] => [id, tag]));
    return { id, ok: true, error: null };
  });
  await addMailboxTags(db, pairs, now);
  return results;
}

async function runBatch(db: D1Database, body: MailboxBatchRequest, now: number): Promise<BatchResult[]> {
  const ids = [...new Set(body.ids)];
  if (body.action === "add_tags") return await addTagsBatch(db, ids, body.tags ?? [], now);
  let affected: number[];
  if (body.action === "remove_tags") {
    affected = [...(await findMailboxTags(db, ids)).keys()];
    await removeMailboxTags(db, affected, body.tags ?? [], now);
  } else if (body.action === "delete") {
    affected = await deleteMailboxes(db, ids);
  } else {
    affected = await setMailboxStatus(db, ids, body.action === "enable" ? "active" : "disabled", now);
  }
  const done = new Set(affected);
  return ids.map((id) => (done.has(id) ? { id, ok: true, error: null } : { id, ok: false, error: "not_found" }));
}

adminMailboxRoutes.post("/batch", async (c) => {
  const db = c.env.APP_DB;
  const body = await parseJsonBody(c, mailboxBatchRequestSchema);
  // 删除前留下地址与引用数（链接与授权里的这些地址随外键级联删除），与单条删除一致
  const deleting = body.action === "delete" ? await findMailboxRows(db, body.ids) : [];
  const results = await runBatch(db, body, nowSec());
  const okIds = new Set(results.filter((r) => r.ok).map((r) => r.id));
  const deleted = deleting
    .filter((row) => okIds.has(row.id))
    .map((row) => ({ id: row.id, address: row.address, link_count: row.link_count, grant_count: row.grant_count }));
  await recordAudit(c, {
    action: AUDIT_ACTIONS.mailboxBatch,
    actorUserId: c.get("auth").user.id,
    targetType: "mailbox",
    detail: { action: body.action, tags: body.tags ?? null, ok_ids: [...okIds], ...(body.action === "delete" && { deleted }) },
  });
  const response: MailboxBatchResponse = { results };
  return c.json(response, HTTP_OK);
});
