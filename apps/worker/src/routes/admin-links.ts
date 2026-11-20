import { Hono } from "hono";
import {
  linkLogQuerySchema,
  shareLinkCreateSchema,
  shareLinkListQuerySchema,
  shareLinkUpdateSchema,
  type LinkLogListResponse,
  type OkResponse,
  type ShareLinkCreateResponse,
  type ShareLinkListResponse,
  type ShareLinkToken,
  type ShareLinkUpdate,
} from "@maillink/shared";
import type { z } from "zod";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { nowSec } from "../clock";
import { listAccessLogs } from "../db/link-activity";
import { deleteShareLink, insertShareLinks, updateShareLink, type NewShareLink, type ShareLinkWrite } from "../db/share-link-writes";
import { findShareLinkStats, listLinkMailboxes, listShareLinkRows, type ShareLinkStatsRow } from "../db/share-links";
import type { AppEnv } from "../env";
import { ApiError, notFoundError } from "../errors";
import { HTTP_CONFLICT, HTTP_CREATED, HTTP_OK } from "../http-status";
import { buildStoredAccess, parseStoredAccess } from "../links/access-config";
import {
  assertWindow,
  auditAccess,
  groupMailboxes,
  loadAdminLink,
  loadAdminLinks,
  requireMailboxes,
  requireRuleGroupId,
} from "../links/admin-service";
import { createLinkToken, decryptLinkToken, linkUrl } from "../links/token";
import { toAdminLink } from "../links/view";
import { parseIdParam, parseJsonBody, parseQuery } from "../validate";

// 管理端"取件链接"的增删改查与 token（04 管理端 / 取件链接）。换绑、重置、预览、批量、导出在 admin-link-ops.ts。
// 鉴权由 index.ts 对 /api/admin/* 统一挂载的 requireAdmin 保证。

export const adminLinkRoutes = new Hono<AppEnv>();

// 响应里可能有完整 token 与访客记录：一律不缓存
adminLinkRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

async function requireLinkRow(db: D1Database, id: number, now: number): Promise<ShareLinkStatsRow> {
  const row = await findShareLinkStats(db, id, now);
  if (!row) throw notFoundError("取件链接不存在");
  return row;
}

adminLinkRoutes.get("/", async (c) => {
  const db = c.env.APP_DB;
  const query = parseQuery(c, shareLinkListQuerySchema);
  const { rows, next_cursor, total } = await listShareLinkRows(db, query, nowSec());
  const mailboxes = await listLinkMailboxes(db, rows.map((row) => row.id));
  const body: ShareLinkListResponse = { items: rows.map((row) => toAdminLink(row, mailboxes)), next_cursor, total };
  return c.json(body, HTTP_OK);
});

adminLinkRoutes.post("/", async (c) => {
  const db = c.env.APP_DB;
  const body = await parseJsonBody(c, shareLinkCreateSchema);
  const now = nowSec();
  await requireRuleGroupId(db, body.rule_group_id);
  const refs = await requireMailboxes(db, body.mailbox_ids, now);
  const access = await buildStoredAccess(c.env, body.access, null);
  const base: ShareLinkWrite = {
    name: body.name ?? null,
    order_ref: body.order_ref ?? null,
    public_title: body.public_title ?? null,
    public_note: body.public_note ?? null,
    rule_group_id: body.rule_group_id,
    status: body.status,
    valid_from: body.valid_from ?? null,
    expires_at: body.expires_at ?? null,
    expire_after_first_access_sec: body.expire_after_first_access_sec ?? null,
    access: JSON.stringify(access),
  };
  const groups = groupMailboxes(body.mode, body.mailbox_ids);
  const tokens = await Promise.all(groups.map(() => createLinkToken(c.env)));
  const links: NewShareLink[] = groups.map((mailboxIds, index) => {
    const { token: _token, ...columns } = tokens[index] as (typeof tokens)[number];
    return { ...base, ...columns, mailbox_ids: mailboxIds };
  });
  const actorId = c.get("auth").user.id;
  const ids = await insertShareLinks(db, links, actorId, now);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.linkCreate,
    actorUserId: actorId,
    targetType: "share_link",
    targetId: ids.join(","),
    detail: { mode: body.mode, count: ids.length, rule_group_id: body.rule_group_id, mailbox_ids: body.mailbox_ids, access: auditAccess(access) },
  });
  const views = await loadAdminLinks(db, ids, now);
  const response: ShareLinkCreateResponse = {
    items: views.map((link, index) => {
      const token = (tokens[index] as (typeof tokens)[number]).token;
      return { link, token, url: linkUrl(c.env, token) };
    }),
    warnings: refs
      .filter((ref) => ref.active_link_count > 0)
      .map((ref) => ({ mailbox_id: ref.id, address: ref.address, active_link_count: ref.active_link_count })),
  };
  return c.json(response, HTTP_CREATED);
});

adminLinkRoutes.get("/:id", async (c) => {
  return c.json(await loadAdminLink(c.env.APP_DB, parseIdParam(c)), HTTP_OK);
});

type UpdateBody = z.output<typeof shareLinkUpdateSchema>;

const PLAIN_FIELDS = ["name", "order_ref", "public_title", "public_note", "valid_from", "expires_at", "expire_after_first_access_sec", "rule_group_id", "status"] as const;

async function buildUpdate(env: AppEnv["Bindings"], row: ShareLinkStatsRow, body: UpdateBody): Promise<Partial<ShareLinkWrite>> {
  if (row.status === "revoked" && body.status !== undefined && body.status !== "revoked") {
    throw new ApiError(HTTP_CONFLICT, "link_revoked", "链接已撤销，不能再恢复；请新建链接");
  }
  if (body.rule_group_id !== undefined) await requireRuleGroupId(env.APP_DB, body.rule_group_id);
  assertWindow(body.valid_from === undefined ? row.valid_from : body.valid_from, body.expires_at === undefined ? row.expires_at : body.expires_at);
  const fields: Partial<ShareLinkWrite> = {};
  for (const key of PLAIN_FIELDS) {
    if (body[key] !== undefined) Object.assign(fields, { [key]: body[key] });
  }
  if (body.access !== undefined) {
    fields.access = JSON.stringify(await buildStoredAccess(env, body.access, parseStoredAccess(row.access)));
  }
  return fields;
}

function changedKeys(body: ShareLinkUpdate): string[] {
  return Object.keys(body).filter((key) => body[key as keyof ShareLinkUpdate] !== undefined);
}

adminLinkRoutes.patch("/:id", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const body = await parseJsonBody(c, shareLinkUpdateSchema);
  const now = nowSec();
  const row = await requireLinkRow(db, id, now);
  const fields = await buildUpdate(c.env, row, body);
  if (!(await updateShareLink(db, id, fields, now))) throw notFoundError("取件链接不存在");
  const revoked = row.status !== "revoked" && body.status === "revoked";
  const access = fields.access === undefined ? undefined : auditAccess(parseStoredAccess(fields.access));
  await recordAudit(c, {
    action: revoked ? AUDIT_ACTIONS.linkRevoke : AUDIT_ACTIONS.linkUpdate,
    actorUserId: c.get("auth").user.id,
    targetType: "share_link",
    targetId: id,
    detail: { changed: changedKeys(body), before_status: row.status, ...(access ? { access } : {}) },
  });
  return c.json(await loadAdminLink(db, id, now), HTTP_OK);
});

adminLinkRoutes.delete("/:id", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const row = await requireLinkRow(db, id, nowSec());
  if (!(await deleteShareLink(db, id))) throw notFoundError("取件链接不存在");
  await recordAudit(c, {
    action: AUDIT_ACTIONS.linkDelete,
    actorUserId: c.get("auth").user.id,
    targetType: "share_link",
    targetId: id,
    detail: { name: row.name, order_ref: row.order_ref, token_hint: row.token_hint, status: row.status },
  });
  const ok: OkResponse = { status: "ok" };
  return c.json(ok, HTTP_OK);
});

adminLinkRoutes.get("/:id/token", async (c) => {
  const id = parseIdParam(c);
  const row = await requireLinkRow(c.env.APP_DB, id, nowSec());
  const token = await decryptLinkToken(c.env, row.token_enc, row.token_hash);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.linkTokenView,
    actorUserId: c.get("auth").user.id,
    targetType: "share_link",
    targetId: id,
    detail: { token_hint: row.token_hint },
  });
  const body: ShareLinkToken = { token, url: linkUrl(c.env, token) };
  return c.json(body, HTTP_OK);
});

adminLinkRoutes.get("/:id/logs", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const query = parseQuery(c, linkLogQuerySchema);
  await requireLinkRow(db, id, nowSec());
  const body: LinkLogListResponse = await listAccessLogs(db, id, query.cursor === undefined ? null : Number(query.cursor), query.limit);
  return c.json(body, HTTP_OK);
});
