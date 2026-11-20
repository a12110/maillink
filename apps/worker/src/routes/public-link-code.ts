import type { Context, Hono } from "hono";
import {
  LINK_API_PASSWORD_HEADER,
  linkApiCodeQuerySchema,
  linkPasswordSchema,
  type LinkApiCodeItem,
  type LinkApiCodeResponse,
  type LinkApiCodeStatus,
} from "@maillink/shared";
import { findRecentCodes, type CodeEntry } from "../access";
import { nowSec } from "../clock";
import { LINK_API_VISITOR_HASH, MS_PER_SEC } from "../constants";
import {
  accessLogStatement,
  deliveredMailIds,
  deliveryCounts,
  insertAccessLog,
  insertDeliveryIfAllowed,
  isMailDelivered,
  markLinkAccessStatement,
  registerVisitor,
  touchVisitorStatement,
  visitorExists,
} from "../db/link-activity";
import type { ShareLinkRow } from "../db/share-links";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { HTTP_BAD_REQUEST, HTTP_OK } from "../http-status";
import { LinkDenied } from "../links/guard";
import { checkLinkPassword } from "../links/password";
import { deliveryQuota, loadLinkRequest, rejectExhaustedDeliveries, rejectWith, type DenyLogMode, type LinkRequest } from "../links/request";
import { linkAnchors, loadLinkScope, type LinkScope } from "../links/scope";
import { presentParties } from "../render";
import { parseQuery, parseWith } from "../validate";

// API 取码：GET /api/s/:token/code（PLAN"API 取码接口"，文档 docs/api-code.md）。
//
// 用 GET 便于脚本调用，是对 02 §6"所有 GET 无副作用"的有意例外：会登记 API 设备、写 first_access_at、计次、写日志。
// 预览机器人只抓 /s/<token> 页面，不会访问这个地址。
// 不经 CSRF：CSRF 中间件只检查写方法；而且这里的鉴权只有路径里的 token 与 X-Link-Password 请求头，
// 不设也不读任何 Cookie（访客 Cookie、会话 Cookie 都不看），跨站页面无法替受害者带上凭据，没有 CSRF 可利用的环境权限。
// 检查顺序与取件页一致：token → 状态 → 生效 / 过期 → IP / 国家 → 限流 → 总次数（loadLinkRequest），
// 之后 access.api → 人机验证 → 无可用邮箱 → 口令 → meta_only → API 设备 → 每日次数。被拒写 api_code 日志。

const LOG: DenyLogMode = "api_code";
const ASCII_MAX = 0x7f;
const BYTE_MAX = 0xff;
const maxCharCode = (text: string): number => Math.max(0, ...Array.from(text, (char) => char.codePointAt(0) ?? 0));

/**
 * 请求头的值在运行时按字节（latin1）给出；curl 等直接发 UTF-8 时，这里把字节还原成 UTF-8 文本，非 ASCII 口令才对得上。
 * 不是合法 UTF-8 时 400（不猜）。
 */
function headerText(raw: string): string {
  const max = maxCharCode(raw);
  if (max <= ASCII_MAX || max > BYTE_MAX) return raw;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(raw, (char) => char.charCodeAt(0)));
  } catch {
    throw new ApiError(HTTP_BAD_REQUEST, "validation_error", `${LINK_API_PASSWORD_HEADER} 需要是 UTF-8 文本`);
  }
}

function passwordFromHeader(c: Context<AppEnv>): string | undefined {
  const raw = c.req.header(LINK_API_PASSWORD_HEADER);
  return raw === undefined ? undefined : parseWith(linkPasswordSchema, headerText(raw));
}

function isoOf(sec: number): string {
  return new Date(sec * MS_PER_SEC).toISOString();
}

/**
 * 接口整体占一台设备（固定标识 LINK_API_VISITOR_HASH）：已登记直接过；未登记时名额未满则登记并激活链接（等同"开始取码"），
 * 满了 403 link_device_limit。并发的首次调用只有一个写入，其余看到已登记。返回激活后的链接行（时间锚点要用）。
 */
async function ensureApiDevice(c: Context<AppEnv>, req: LinkRequest): Promise<ShareLinkRow> {
  const db = c.env.APP_DB;
  const linkId = req.row.id;
  const registered =
    (await visitorExists(db, linkId, LINK_API_VISITOR_HASH)) ||
    (await registerVisitor(db, linkId, LINK_API_VISITOR_HASH, req.access.max_devices ?? null, req.client, req.now)) ||
    (await visitorExists(db, linkId, LINK_API_VISITOR_HASH));
  if (!registered) await rejectWith(c, req, "device_limit", LOG, { public_note: req.row.public_note });
  if (req.row.first_access_at !== null) return req.row;
  await markLinkAccessStatement(db, linkId, req.now, true).run();
  return { ...req.row, first_access_at: req.now };
}

/**
 * click 链接：从新到旧逐封交付，与网页 reveal 共用 link_deliveries（同一封不重复计，条件 INSERT 保证并发不超额）。
 * 次数不够时只返回额度允许的、连续的最新几封；最新一封就交付不了时按总数（410）/ 每日（429）拒绝。
 */
async function deliverCodes(c: Context<AppEnv>, req: LinkRequest, entries: readonly CodeEntry[]): Promise<CodeEntry[]> {
  const db = c.env.APP_DB;
  const linkId = req.row.id;
  const delivered = await deliveredMailIds(db, linkId, new Map(entries.map((entry) => [entry.mail_id, entry.identity])));
  const limits = { total: req.access.max_deliveries_total ?? null, daily: req.access.max_deliveries_per_day ?? null };
  const allowed: CodeEntry[] = [];
  const logs: D1PreparedStatement[] = [];
  for (const entry of entries) {
    const delivery = { link_id: linkId, mail_id: entry.mail_id, mail: entry.identity, visitor_hash: LINK_API_VISITOR_HASH, now: req.now };
    if (!delivered.has(entry.mail_id)) {
      // 逐封顺序写：后一封能否计次取决于前一封是否占了额度
      const counted = await insertDeliveryIfAllowed(db, delivery, limits);
      if (counted) {
        logs.push(accessLogStatement(db, { link_id: linkId, event: "deliver", mail_id: entry.mail_id, reason: null, created_at: req.now, ...req.client }));
      } else if (!(await isMailDelivered(db, linkId, entry.mail_id, entry.identity))) {
        // 没写进去也不是并发的另一次调用刚记过：次数满了
        if (allowed.length > 0) break;
        await rejectExhaustedDeliveries(c, req, LOG);
      }
    }
    allowed.push(entry);
  }
  if (logs.length > 0) await db.batch([...logs, markLinkAccessStatement(db, linkId, req.now, false)]);
  return allowed;
}

function itemOf(entry: CodeEntry): LinkApiCodeItem {
  return { code: entry.code, received_at: entry.received_at, received_at_iso: isoOf(entry.received_at), mail_id: entry.mail_id };
}

type Outcome = { status: LinkApiCodeStatus; entries: readonly CodeEntry[]; partial: boolean };

type NewestFields = Pick<LinkApiCodeResponse, "code" | "received_at" | "received_at_iso" | "mail_id" | "sender" | "mailbox">;

const NO_NEWEST: NewestFields = { code: null, received_at: null, received_at_iso: null, mail_id: null, sender: null, mailbox: null };

/** 最新一封的字段；发件人与收件地址按规则组 present.sender / present.recipient 裁剪 */
function newestFields(scope: LinkScope, newest: CodeEntry | undefined): NewestFields {
  if (newest === undefined) return NO_NEWEST;
  const parties = presentParties(scope.compiled.config.present, newest.facts);
  return { ...itemOf(newest), sender: parties.sender ?? null, mailbox: parties.recipient ?? null };
}

async function buildResponse(c: Context<AppEnv>, req: LinkRequest, scope: LinkScope, outcome: Outcome): Promise<LinkApiCodeResponse> {
  const counts = req.counts === null ? null : await deliveryCounts(c.env.APP_DB, req.row.id, req.now);
  const quota = deliveryQuota(req.access, counts);
  return {
    status: outcome.status,
    ...newestFields(scope, outcome.entries[0]),
    partial: outcome.partial,
    retry_after_sec: outcome.status === "ok" ? null : req.access.poll_interval_sec,
    remaining: quota === null ? null : { total: quota.total_remaining, today: quota.daily_remaining },
    items: outcome.entries.map(itemOf),
  };
}

/** view = meta_only：规则组只给元信息，永远不返回验证码；不登记设备、不激活、不计次（PLAN 裁定 200 no_code） */
async function metaOnlyResponse(c: Context<AppEnv>, req: LinkRequest): Promise<LinkApiCodeResponse> {
  await insertAccessLog(c.env.APP_DB, { link_id: req.row.id, event: "api_code", mail_id: null, reason: "view_meta_only", created_at: req.now, ...req.client });
  return {
    status: "no_code",
    ...NO_NEWEST,
    partial: false,
    retry_after_sec: null,
    remaining: null,
    items: [],
    reason: "view_meta_only",
  };
}

function statusOf(entries: readonly CodeEntry[], partial: boolean): LinkApiCodeStatus {
  if (entries.length > 0) return "ok";
  return partial ? "pending" : "no_code";
}

async function apiCode(c: Context<AppEnv>): Promise<LinkApiCodeResponse> {
  const query = parseQuery(c, linkApiCodeQuerySchema);
  const req = await loadLinkRequest(c, LOG);
  if (!req.access.api) await rejectWith(c, req, "api_disabled", LOG);
  if (req.access.turnstile) await rejectWith(c, req, "turnstile_required", LOG);
  const scope = await loadLinkScope(c.env.APP_DB, req.row);
  if (scope.mailboxCount === 0) await rejectWith(c, req, "no_mailbox", LOG);
  await checkLinkPassword(c, req, passwordFromHeader(c), LOG);
  if (scope.compiled.config.present.view === "meta_only") return await metaOnlyResponse(c, req);
  const row = await ensureApiDevice(c, req);
  const found = await findRecentCodes(c.env, { ...scope.scope, anchors: linkAnchors(row) }, { now: req.now, since: query.since ?? null, limit: query.limit });
  // pending（还没找到验证码）不交付、不计次
  const entries = req.access.reveal === "click" && found.entries.length > 0 ? await deliverCodes(c, req, found.entries) : found.entries;
  const status = statusOf(entries, found.partial);
  const db = c.env.APP_DB;
  await db.batch([
    accessLogStatement(db, { link_id: req.row.id, event: "api_code", mail_id: entries[0]?.mail_id ?? null, reason: status, created_at: req.now, ...req.client }),
    touchVisitorStatement(db, req.row.id, LINK_API_VISITOR_HASH, req.client, req.now),
  ]);
  return await buildResponse(c, req, scope, { status, entries, partial: found.partial });
}

/** 带"大约何时恢复"的拒绝（每日次数用尽、口令锁定）同时给 Retry-After，onError 里的 c.json 会带上 */
function withRetryAfter(c: Context<AppEnv>, error: unknown): never {
  const at = error instanceof LinkDenied ? error.extra["retry_after_at"] : undefined;
  if (typeof at === "number") {
    c.header("Retry-After", String(Math.max(1, at - nowSec())));
  }
  throw error;
}

export function registerApiCodeRoute(routes: Hono<AppEnv>): void {
  routes.get("/:token/code", async (c) => {
    try {
      return c.json(await apiCode(c), HTTP_OK);
    } catch (error) {
      return withRetryAfter(c, error);
    }
  });
}
