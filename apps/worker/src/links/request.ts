import type { Context } from "hono";
import type { LinkAccessStored, LinkDeliveryQuota } from "@maillink/shared";
import { clientIp } from "../auth/session";
import { nowSec } from "../clock";
import { LINK_DELIVERY_WINDOW_SEC, LINK_USER_AGENT_MAX_LENGTH, RATE_LIMIT_PURPOSES } from "../constants";
import { deliveryCounts, insertAccessLog, type ClientInfo, type DeliveryCounts } from "../db/link-activity";
import { findShareLinkByTokenHash, type ShareLinkRow } from "../db/share-links";
import type { AppEnv } from "../env";
import { enforceRateLimit, requestIp } from "../ratelimit";
import { parseStoredAccess } from "./access-config";
import { checkNetwork, checkStatusAndTime, denial, linkNotFound, type DenyReason } from "./guard";
import { hashLinkToken, isWellFormedToken } from "./token";

// 公开接口的前半段检查（02 §6 检查顺序）：token 查找 → 状态 → 生效 / 过期 → IP / 国家 → 限流 → 总次数。
// 访客 Cookie → 设备数 → 每日次数在 visitor.ts 与各路由里继续。

export type LinkRequest = {
  row: ShareLinkRow;
  access: LinkAccessStored;
  tokenHash: string;
  now: number;
  client: ClientInfo;
  /** 设了任一取码上限时才查 */
  counts: DeliveryCounts | null;
};

export function clientInfo(c: Context<AppEnv>): ClientInfo {
  const cf = c.req.raw.cf as { country?: unknown } | undefined;
  return {
    ip: clientIp(c),
    country: typeof cf?.country === "string" ? cf.country : null,
    user_agent: c.req.header("User-Agent")?.slice(0, LINK_USER_AGENT_MAX_LENGTH) ?? null,
  };
}

/** 被拒时写一条 denied 日志（只在 POST 上调用：GET 一律无副作用）然后抛出对外错误 */
export async function rejectWith(c: Context<AppEnv>, req: Pick<LinkRequest, "row" | "now" | "client">, reason: DenyReason, log: boolean, extra?: Record<string, unknown>): Promise<never> {
  if (log) {
    await insertAccessLog(c.env.APP_DB, { link_id: req.row.id, event: "denied", mail_id: null, reason, created_at: req.now, ...req.client });
  }
  throw denial(reason, extra);
}

function hasDeliveryLimits(access: LinkAccessStored): boolean {
  return access.max_deliveries_total !== undefined || access.max_deliveries_per_day !== undefined;
}

/** 只按 token_hash 精确查找；格式不对的 token 不查库 */
async function findByToken(c: Context<AppEnv>): Promise<{ row: ShareLinkRow; tokenHash: string }> {
  const token = c.req.param("token") ?? "";
  if (!isWellFormedToken(token)) throw linkNotFound();
  const tokenHash = await hashLinkToken(token);
  const row = await findShareLinkByTokenHash(c.env.APP_DB, tokenHash);
  if (!row) throw linkNotFound();
  return { row, tokenHash };
}

/**
 * `log`：是否把拒绝原因写进 link_access_logs（POST 写，GET 不写）。
 * 限流在 02 §6 的位置是 IP / 国家之后、访客 Cookie 之前；但 POST 在更早一步被拒时也要写日志，
 * 为了不让被拒的写请求绕过限流刷日志，这种情况下先限流再写（同一请求只计一次）。
 */
export async function loadLinkRequest(c: Context<AppEnv>, log: boolean): Promise<LinkRequest> {
  const { row, tokenHash } = await findByToken(c);
  const now = nowSec();
  const access = parseStoredAccess(row.access);
  const client = clientInfo(c);
  const base = { row, now, client };
  const limit = () => enforceRateLimit(c, RATE_LIMIT_PURPOSES.link, tokenHash, requestIp(c));
  const earlyReject = async (reason: DenyReason, extra?: Record<string, unknown>): Promise<never> => {
    if (log) await limit();
    return await rejectWith(c, base, reason, log, extra);
  };
  const timeIssue = checkStatusAndTime(row, now);
  if (timeIssue !== null) await earlyReject(timeIssue, timeIssue === "not_yet_valid" ? { valid_from: row.valid_from } : undefined);
  const networkIssue = checkNetwork(access, client);
  if (networkIssue !== null) await earlyReject(networkIssue);
  // 限流：按 token_hash + IP 计，走独立的 LINK_RATE_LIMITER；缺 binding 时 503 rate_limiter_not_configured（不静默放行），
  // 超限 429 rate_limited。管理员预览不经过这里。
  await limit();
  const counts = hasDeliveryLimits(access) ? await deliveryCounts(c.env.APP_DB, row.id, now) : null;
  if (counts !== null && access.max_deliveries_total !== undefined && counts.total >= access.max_deliveries_total) {
    await rejectWith(c, base, "total_limit", log);
  }
  return { row, access, tokenHash, now, client, counts };
}

export function deliveryQuota(access: LinkAccessStored, counts: DeliveryCounts | null): LinkDeliveryQuota | null {
  if (counts === null) return null;
  const total = access.max_deliveries_total ?? null;
  const daily = access.max_deliveries_per_day ?? null;
  const dailyExhausted = daily !== null && counts.daily >= daily;
  return {
    total_limit: total,
    total_used: counts.total,
    total_remaining: total === null ? null : Math.max(0, total - counts.total),
    daily_limit: daily,
    daily_used: counts.daily,
    daily_remaining: daily === null ? null : Math.max(0, daily - counts.daily),
    // 窗口内最早一次取码 + 24 小时（PLAN 裁定的"大约何时恢复"）
    daily_resets_at: dailyExhausted && counts.oldest_in_window !== null ? counts.oldest_in_window + LINK_DELIVERY_WINDOW_SEC : null,
  };
}
