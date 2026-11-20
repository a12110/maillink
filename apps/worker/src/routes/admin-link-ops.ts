import { Hono } from "hono";
import {
  SHARE_LINK_LIMITS,
  linkPreviewQuerySchema,
  shareLinkBatchSchema,
  shareLinkExportSchema,
  shareLinkRebindSchema,
  shareLinkResetSchema,
  shareLinkRotateSchema,
  type LinkPreviewResponse,
  type ShareLinkBatchResponse,
  type ShareLinkExportResponse,
  type ShareLinkRotateResponse,
} from "@maillink/shared";
import { compileStoredPolicy, testRuleGroup } from "../access";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { nowSec } from "../clock";
import { LINK_VISITOR_HINT_LENGTH } from "../constants";
import { deliveredMailIds, listDeliveries, listVisitors } from "../db/link-activity";
import { applyBatchAction, findLinkStatuses, rebindShareLink, replaceToken, resetShareLink, type BatchAction } from "../db/share-link-writes";
import { findShareLinkStats, findShareLinksStats, listLinkMailboxes, type ShareLinkStatsRow } from "../db/share-links";
import type { AppEnv } from "../env";
import { ApiError, notFoundError } from "../errors";
import { HTTP_BAD_REQUEST, HTTP_OK } from "../http-status";
import { loadAdminLink, requireMailboxes, requireRuleGroupId } from "../links/admin-service";
import { renderTemplate, toCsv, validateTemplate, type ExportRow } from "../links/export";
import { linkAnchors } from "../links/scope";
import { createLinkToken, decryptLinkToken, linkTokenKey, linkUrl } from "../links/token";
import { toAdminLink } from "../links/view";
import { computeTimeLowerBound } from "../rules";
import { parseIdParam, parseJsonBody, parseQuery } from "../validate";

// 管理端"取件链接"的运维操作：重置 token、换绑、重置、预览、批量、导出。

export const adminLinkOpsRoutes = new Hono<AppEnv>();

adminLinkOpsRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

async function requireLinkRow(db: D1Database, id: number, now: number): Promise<ShareLinkStatsRow> {
  const row = await findShareLinkStats(db, id, now);
  if (!row) throw notFoundError("取件链接不存在");
  return row;
}

const actorOf = (c: { get: (key: "auth") => { user: { id: number } } }) => c.get("auth").user.id;

adminLinkOpsRoutes.post("/:id/rotate", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const now = nowSec();
  const { reset_devices: resetDevices } = await parseJsonBody(c, shareLinkRotateSchema);
  const row = await requireLinkRow(db, id, now);
  const fresh = await createLinkToken(await linkTokenKey(c.env));
  const { token, ...columns } = fresh;
  if (!(await replaceToken(db, id, columns, now, resetDevices))) throw notFoundError("取件链接不存在");
  await recordAudit(c, {
    action: AUDIT_ACTIONS.linkTokenRotate,
    actorUserId: actorOf(c),
    targetType: "share_link",
    targetId: id,
    detail: { old_token_hint: row.token_hint, new_token_hint: columns.token_hint, reset_devices: resetDevices },
  });
  const body: ShareLinkRotateResponse = { token, url: linkUrl(c.env, token), link: await loadAdminLink(db, id, now) };
  return c.json(body, HTTP_OK);
});

adminLinkOpsRoutes.post("/:id/rebind", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const body = await parseJsonBody(c, shareLinkRebindSchema);
  const now = nowSec();
  await requireLinkRow(db, id, now);
  const before = await listLinkMailboxes(db, [id]);
  const after = await requireMailboxes(db, body.mailbox_ids, now);
  const { mailbox_ids: mailboxIds, ...flags } = body;
  await rebindShareLink(db, id, mailboxIds, flags, now);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.linkRebind,
    actorUserId: actorOf(c),
    targetType: "share_link",
    targetId: id,
    detail: { before: before.map((mailbox) => mailbox.address), after: after.map((mailbox) => mailbox.address), ...flags },
  });
  return c.json(await loadAdminLink(db, id, now), HTTP_OK);
});

adminLinkOpsRoutes.post("/:id/reset", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const flags = await parseJsonBody(c, shareLinkResetSchema);
  const now = nowSec();
  await requireLinkRow(db, id, now);
  await resetShareLink(db, id, flags, now);
  await recordAudit(c, { action: AUDIT_ACTIONS.linkReset, actorUserId: actorOf(c), targetType: "share_link", targetId: id, detail: flags });
  return c.json(await loadAdminLink(db, id, now), HTTP_OK);
});

/** 预览：以链接的作用域与锚点求值并给出逐封 trace。只读：不登记设备、不计次、不写 first_access_at、不写访问日志 */
adminLinkOpsRoutes.get("/:id/preview", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const { limit = SHARE_LINK_LIMITS.previewDefaultMails } = parseQuery(c, linkPreviewQuerySchema);
  const now = nowSec();
  const row = await requireLinkRow(db, id, now);
  const mailboxes = await listLinkMailboxes(db, [id]);
  const addresses = mailboxes.filter((mailbox) => mailbox.status === "active").map((mailbox) => mailbox.address);
  const compiled = compileStoredPolicy(row.rule_group_config);
  const anchors = linkAnchors(row);
  const result =
    addresses.length === 0
      ? { items: [], partial: false, time_lower_bound: computeTimeLowerBound(compiled.config.time, anchors, now) }
      : await testRuleGroup(c.env, compiled, { addresses }, { now, anchors, limit });
  const delivered = await deliveredMailIds(db, id, result.items.map((item) => item.mail_id));
  const hint = (hash: string) => hash.slice(0, LINK_VISITOR_HINT_LENGTH);
  const [visitors, deliveries] = await Promise.all([
    listVisitors(db, id, SHARE_LINK_LIMITS.previewRecordsMax),
    listDeliveries(db, id, SHARE_LINK_LIMITS.previewRecordsMax),
  ]);
  const body: LinkPreviewResponse = {
    link: toAdminLink(row, mailboxes),
    time_lower_bound: result.time_lower_bound,
    partial: result.partial,
    items: result.items.map((item) => ({ ...item, delivered: delivered.has(item.mail_id) })),
    visitors: visitors.map(({ visitor_hash: visitorHash, ...rest }) => ({ ...rest, visitor: hint(visitorHash) })),
    deliveries: deliveries.map(({ visitor_hash: visitorHash, ...rest }) => ({ ...rest, visitor: hint(visitorHash) })),
  };
  return c.json(body, HTTP_OK);
});

/** 批量操作中没改动的链接的原因 */
function batchError(action: BatchAction["action"], info: { status: string; has_deadline: boolean } | undefined): string {
  if (info === undefined) return "not_found";
  if (info.status === "revoked") return "link_revoked";
  if (action === "pause") return "not_active";
  if (action === "resume") return "not_paused";
  if (action === "extend" && !info.has_deadline) return "no_deadline";
  return "unchanged";
}

adminLinkOpsRoutes.post("/batch", async (c) => {
  const db = c.env.APP_DB;
  const body = await parseJsonBody(c, shareLinkBatchSchema);
  const now = nowSec();
  const { ids: _ids, ...action } = body;
  if (action.action === "set_rule_group") await requireRuleGroupId(db, action.rule_group_id);
  const changed = await applyBatchAction(db, body.ids, action, now);
  const failed = body.ids.filter((id) => !changed.has(id));
  const statuses = failed.length > 0 ? await findLinkStatuses(db, failed) : new Map();
  const response: ShareLinkBatchResponse = {
    results: body.ids.map((id) => (changed.has(id) ? { id, ok: true } : { id, ok: false, error: batchError(action.action, statuses.get(id)) })),
  };
  await recordAudit(c, {
    action: AUDIT_ACTIONS.linkBatch,
    actorUserId: actorOf(c),
    targetType: "share_link",
    targetId: [...changed].join(","),
    detail: { ...action, ids: body.ids, changed: [...changed] },
  });
  return c.json(response, HTTP_OK);
});

adminLinkOpsRoutes.post("/export", async (c) => {
  const db = c.env.APP_DB;
  const body = await parseJsonBody(c, shareLinkExportSchema);
  if (body.template !== undefined) validateTemplate(body.template);
  const rows = await findShareLinksStats(db, body.ids, nowSec());
  const found = new Set(rows.map((row) => row.id));
  const missing = body.ids.filter((id) => !found.has(id));
  if (missing.length > 0) throw new ApiError(HTTP_BAD_REQUEST, "link_not_found", `取件链接不存在：${missing.join(", ")}`);
  const mailboxes = await listLinkMailboxes(db, body.ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const key = await linkTokenKey(c.env);
  const exportRows: ExportRow[] = [];
  for (const id of body.ids) {
    const row = byId.get(id) as ShareLinkStatsRow;
    const own = mailboxes.filter((mailbox) => mailbox.link_id === id);
    const token = await decryptLinkToken(key, row.token_enc, row.token_hash);
    exportRows.push({
      address: own.map((mailbox) => mailbox.address).join(";"),
      note: own.map((mailbox) => mailbox.note ?? "").filter((note) => note !== "").join(";"),
      link: linkUrl(c.env, token),
      name: row.name ?? "",
      order_ref: row.order_ref ?? "",
    });
  }
  const content = body.template === undefined ? toCsv(exportRows) : renderTemplate(body.template, exportRows);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.linkExport,
    actorUserId: actorOf(c),
    targetType: "share_link",
    targetId: body.ids.join(","),
    detail: { format: body.format, count: body.ids.length },
  });
  const response: ShareLinkExportResponse = { format: body.format, content, count: exportRows.length };
  return c.json(response, HTTP_OK);
});
