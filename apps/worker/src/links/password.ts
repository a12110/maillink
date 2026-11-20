import type { Context } from "hono";
import { verifyPassword } from "../auth/password";
import { LINK_PASSWORD_BUSY_RETRY_SEC } from "../constants";
import { claimPasswordCheck, passwordIpBucket, settlePasswordCheck } from "../db/link-password";
import type { AppEnv } from "../env";
import { denial } from "./guard";
import { rejectWith, type DenyLogMode, type LinkRequest } from "./request";

type Outcome = "valid" | "invalid" | "error";

/**
 * 链接口令（"开始取码"与 API 取码共用）。PBKDF2 之前先占一个"进行中"名额（db/link-password.ts）：
 * 失败数已满 → 429 link_password_locked；进行中已满 → 429 link_password_busy + 短 Retry-After（不锁定、不计失败）。
 * 只有校验失败才计入锁定；占位在成功、失败、异常时都释放（异常不计失败）。缺口令不占名额。
 */
export async function checkLinkPassword(c: Context<AppEnv>, req: LinkRequest, password: string | undefined, log: DenyLogMode): Promise<void> {
  const hash = req.access.password_hash;
  if (hash === undefined) return;
  if (password === undefined) throw denial("password_required");
  const db = c.env.APP_DB;
  const bucket = passwordIpBucket(req.client.ip);
  const claim = await claimPasswordCheck(db, req.row.id, bucket, req.now);
  if (claim.kind === "locked") return await rejectWith(c, req, "password_locked", log, { retry_after_at: claim.retryAfter });
  if (claim.kind === "busy") {
    c.header("Retry-After", String(LINK_PASSWORD_BUSY_RETRY_SEC));
    return await rejectWith(c, req, "password_busy", log, { retry_after_at: req.now + LINK_PASSWORD_BUSY_RETRY_SEC });
  }
  let outcome: Outcome = "error";
  try {
    outcome = (await verifyPassword(c.env, password, hash)) ? "valid" : "invalid";
  } finally {
    await settlePasswordCheck(db, claim.id, outcome === "invalid" ? { linkId: req.row.id, bucket, now: req.now } : null);
  }
  if (outcome === "invalid") await rejectWith(c, req, "bad_password", log);
}
