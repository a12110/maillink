import { Hono } from "hono";
import type { ErrorHandler } from "hono";
import {
  LINK_PUBLIC_ERRORS,
  linkMailListQuerySchema,
  linkStartRequestSchema,
  type LinkPublicStatus,
  type LinkRevealResponse,
  type VisibleMailListResponse,
} from "@maillink/shared";
import { z } from "zod";
import { getVisibleAttachment, getVisibleMailDetail, listVisibleMails } from "../access";
import { verifyPassword } from "../auth/password";
import { createMiddleware } from "hono/factory";
import {
  accessLogStatement,
  deliveredMailIds,
  deliveryCounts,
  insertAccessLog,
  insertDeliveryIfAllowed,
  markLinkAccessStatement,
  registerVisitor,
  touchVisitorStatement,
} from "../db/link-activity";
import { claimPasswordAttempt, passwordIpBucket, releasePasswordAttempt } from "../db/link-password";
import type { AppEnv } from "../env";
import { ApiError, notFoundError } from "../errors";
import { HTTP_CONFLICT, HTTP_OK } from "../http-status";
import { LinkDenied, denial, type DenyReason } from "../links/guard";
import { deliveryQuota, loadLinkRequest, rejectWith, type LinkRequest } from "../links/request";
import { loadLinkScope, type LinkScope } from "../links/scope";
import { buildPublicStatus, findVisibleListItem } from "../links/status";
import { hashLinkToken } from "../links/token";
import { identifyVisitor, issueVisitorCookie, newVisitorValue, requireVisitor } from "../links/visitor";
import { onError } from "../middleware/error";
import { enforceTurnstile } from "../turnstile/verify";
import { lockPresentedMail } from "../render";
import { parseIdParam, parseJsonBody, parseQuery, parseWith } from "../validate";
import { attachmentDisposition } from "./content-disposition";

// 公开取件接口 /api/s/:token/*（02 §6，04 取件链接公开页）。
// 所有 GET 无副作用（不登记设备、不写 first_access_at、不写日志），唯一例外是附件下载成功写 download 日志（派发要求）。
// 写接口（start / reveal）经过全局 CSRF 中间件（同源页面调用）。

export const publicLinkRoutes = new Hono<AppEnv>();

const handleError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof LinkDenied) {
    return c.json({ error: { code: err.code, message: err.message, ...err.extra } }, err.status);
  }
  return onError(err, c);
};
publicLinkRoutes.onError(handleError);

/** 公开接口的安全头。由 index.ts 以 app.use("/api/s/*") 挂在 CSRF 之前，CSRF 拒绝等早于路由的错误响应也带上 */
export const linkSecurityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Robots-Tag", "noindex, nofollow");
  c.header("X-Content-Type-Options", "nosniff");
});

async function requireMailboxScope(c: Parameters<typeof loadLinkRequest>[0], req: LinkRequest, log: boolean): Promise<LinkScope> {
  const scope = await loadLinkScope(c.env.APP_DB, req.row);
  if (scope.mailboxCount === 0) await rejectWith(c, req, "no_mailbox", log);
  return scope;
}

publicLinkRoutes.get("/:token", async (c) => {
  const req = await loadLinkRequest(c, false);
  const scope = await loadLinkScope(c.env.APP_DB, req.row);
  const visitor = await identifyVisitor(c, req.row.id);
  const body: LinkPublicStatus = await buildPublicStatus(c.env.APP_DB, req, scope, visitor);
  return c.json(body, HTTP_OK);
});

/**
 * 口令：PBKDF2 之前先占一个失败名额（链接 + IP 桶、链接全局两层上限），占不到直接锁定，
 * 并发的错口令请求最多只有上限个进入 PBKDF2；口令正确时释放占位。缺口令不计次。
 */
async function checkPassword(c: Parameters<typeof loadLinkRequest>[0], req: LinkRequest, password: string | undefined): Promise<void> {
  const hash = req.access.password_hash;
  if (hash === undefined) return;
  if (password === undefined) throw denial("password_required");
  const db = c.env.APP_DB;
  const claim = await claimPasswordAttempt(db, req.row.id, passwordIpBucket(req.client.ip), req.now);
  if (!claim.ok) return await rejectWith(c, req, "password_locked", true, { retry_after_at: claim.retryAfter });
  if (await verifyPassword(c.env, password, hash)) {
    await releasePasswordAttempt(db, claim.attemptId);
    return;
  }
  await rejectWith(c, req, "bad_password", true);
}

/**
 * 人机验证：只看链接自己的开关（enforceTurnstile 的 forced）。失败沿用 M6 的错误码原样抛出，并写 denied 日志；
 * 此时 loadLinkRequest 已经限流，写日志不会被无限刷。放在口令占位之前，失败的请求不进 PBKDF2、不占口令名额。
 */
async function checkTurnstile(c: Parameters<typeof loadLinkRequest>[0], req: LinkRequest, token: string | undefined): Promise<void> {
  try {
    await enforceTurnstile(c, "pickup", token, { forced: req.access.turnstile });
  } catch (error) {
    if (error instanceof ApiError) {
      const reason: DenyReason = error.code === "turnstile_failed" ? "turnstile_failed" : "turnstile_unavailable";
      await insertAccessLog(c.env.APP_DB, { link_id: req.row.id, event: "denied", mail_id: null, reason, created_at: req.now, ...req.client });
    }
    throw error;
  }
}

publicLinkRoutes.post("/:token/start", async (c) => {
  const req = await loadLinkRequest(c, true);
  const body = await parseJsonBody(c, linkStartRequestSchema);
  const db = c.env.APP_DB;
  const scope = await requireMailboxScope(c, req, true);
  const existing = await identifyVisitor(c, req.row.id);
  if (existing.registered && existing.hash !== null && existing.value !== null) {
    await db.batch([touchVisitorStatement(db, req.row.id, existing.hash, req.client, req.now), markLinkAccessStatement(db, req.row.id, req.now, true)]);
    const activated = { ...req.row, first_access_at: req.row.first_access_at ?? req.now };
    await issueVisitorCookie(c, activated, existing.value, req.now);
    return c.json(await buildPublicStatus(db, { ...req, row: activated }, scope, existing), HTTP_OK);
  }
  await checkTurnstile(c, req, body.turnstile_token);
  await checkPassword(c, req, body.password);
  const value = newVisitorValue();
  const hash = await hashLinkToken(value);
  if (!(await registerVisitor(db, req.row.id, hash, req.access.max_devices ?? null, req.client, req.now))) {
    await rejectWith(c, req, "device_limit", true, { public_note: req.row.public_note });
  }
  await db.batch([
    markLinkAccessStatement(db, req.row.id, req.now, true),
    accessLogStatement(db, { link_id: req.row.id, event: "start", mail_id: null, reason: null, created_at: req.now, ...req.client }),
  ]);
  const row = { ...req.row, first_access_at: req.row.first_access_at ?? req.now };
  await issueVisitorCookie(c, row, value, req.now);
  return c.json(await buildPublicStatus(db, { ...req, row }, scope, { hash, value, registered: true }), HTTP_OK);
});

publicLinkRoutes.get("/:token/mails", async (c) => {
  const req = await loadLinkRequest(c, false);
  const scope = await requireMailboxScope(c, req, false);
  await requireVisitor(c, req);
  const query = parseQuery(c, linkMailListQuerySchema);
  const result = await listVisibleMailsFor(c.env, scope, query, req.now);
  if (req.access.reveal !== "click") return c.json(result, HTTP_OK);
  const delivered = await deliveredMailIds(c.env.APP_DB, req.row.id, result.items.map((mail) => mail.id));
  const body: VisibleMailListResponse = { ...result, items: result.items.map((mail) => (delivered.has(mail.id) ? mail : lockPresentedMail(mail))) };
  return c.json(body, HTTP_OK);
});

async function listVisibleMailsFor(env: AppEnv["Bindings"], scope: LinkScope, query: z.output<typeof linkMailListQuerySchema>, now: number): Promise<VisibleMailListResponse> {
  return await listVisibleMails(env, scope.scope, { cursor: query.cursor, afterId: query.after_id, now });
}

/** 次数没写进去：已交付过的（不重复计）或者次数满了（区分总数与每日） */
async function explainRefusedDelivery(c: Parameters<typeof loadLinkRequest>[0], req: LinkRequest, mailId: number): Promise<void> {
  if ((await deliveredMailIds(c.env.APP_DB, req.row.id, [mailId])).has(mailId)) return;
  const counts = await deliveryCounts(c.env.APP_DB, req.row.id, req.now);
  if (req.access.max_deliveries_total !== undefined && counts.total >= req.access.max_deliveries_total) {
    await rejectWith(c, req, "total_limit", true);
  }
  const quota = deliveryQuota(req.access, counts);
  await rejectWith(c, req, "daily_limit", true, { retry_after_at: quota?.daily_resets_at ?? null });
}

publicLinkRoutes.post("/:token/mails/:id/reveal", async (c) => {
  const req = await loadLinkRequest(c, true);
  const mailId = parseIdParam(c);
  if (req.access.reveal !== "click") {
    throw new ApiError(HTTP_CONFLICT, LINK_PUBLIC_ERRORS.revealNotApplicable, "这个链接的邮件会自动显示，不需要点击取码");
  }
  const scope = await requireMailboxScope(c, req, true);
  const visitor = await requireVisitor(c, req);
  const visitorHash = visitor.hash;
  const mail = await findVisibleListItem(c.env, scope.scope, mailId, req.now);
  const db = c.env.APP_DB;
  const limits = { total: req.access.max_deliveries_total ?? null, daily: req.access.max_deliveries_per_day ?? null };
  const counted = await insertDeliveryIfAllowed(db, { link_id: req.row.id, mail_id: mailId, visitor_hash: visitorHash, now: req.now }, limits);
  if (counted) {
    await db.batch([
      accessLogStatement(db, { link_id: req.row.id, event: "deliver", mail_id: mailId, reason: null, created_at: req.now, ...req.client }),
      markLinkAccessStatement(db, req.row.id, req.now, false),
      touchVisitorStatement(db, req.row.id, visitorHash, req.client, req.now),
    ]);
  } else {
    await explainRefusedDelivery(c, req, mailId);
  }
  await issueVisitorCookie(c, req.row, visitor.value, req.now);
  const counts = req.counts === null ? null : await deliveryCounts(db, req.row.id, req.now);
  const body: LinkRevealResponse = { mail, counted, deliveries: deliveryQuota(req.access, counts) };
  return c.json(body, HTTP_OK);
});

/** 详情与附件共用：访客已登记、click 模式下这封已交付给本链接 */
async function detailContext(c: Parameters<typeof loadLinkRequest>[0]): Promise<{ req: LinkRequest; scope: LinkScope; mailId: number }> {
  const req = await loadLinkRequest(c, false);
  const mailId = parseIdParam(c);
  const scope = await requireMailboxScope(c, req, false);
  await requireVisitor(c, req);
  if (req.access.reveal === "click" && !(await deliveredMailIds(c.env.APP_DB, req.row.id, [mailId])).has(mailId)) {
    throw notFoundError("邮件不存在");
  }
  return { req, scope, mailId };
}

publicLinkRoutes.get("/:token/mails/:id", async (c) => {
  const { req, scope, mailId } = await detailContext(c);
  return c.json(await getVisibleMailDetail(c.env, scope.scope, mailId, { now: req.now }), HTTP_OK);
});

const attachmentIndexSchema = z.coerce.number().int().min(0);

publicLinkRoutes.get("/:token/mails/:id/attachments/:index", async (c) => {
  const { req, scope, mailId } = await detailContext(c);
  const index = parseWith(attachmentIndexSchema, c.req.param("index"));
  const attachment = await getVisibleAttachment(c.env, scope.scope, mailId, index, { now: req.now });
  await insertAccessLog(c.env.APP_DB, { link_id: req.row.id, event: "download", mail_id: mailId, reason: `attachment:${index}`, created_at: req.now, ...req.client });
  return new Response(attachment.content, {
    status: HTTP_OK,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": attachmentDisposition(attachment.filename, `attachment-${index}`),
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(attachment.content.byteLength),
    },
  });
});
