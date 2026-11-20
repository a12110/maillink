import type { Context } from "hono";
import { verifyPassword } from "../auth/password";
import { claimPasswordAttempt, passwordIpBucket, releasePasswordAttempt } from "../db/link-password";
import type { AppEnv } from "../env";
import { denial } from "./guard";
import { rejectWith, type DenyLogMode, type LinkRequest } from "./request";

/**
 * 链接口令（"开始取码"与 API 取码共用）：PBKDF2 之前先占一个失败名额（链接 + IP 桶、链接全局两层上限），占不到直接锁定，
 * 并发的错口令请求最多只有上限个进入 PBKDF2；口令正确时释放占位。缺口令不计次。
 */
export async function checkLinkPassword(c: Context<AppEnv>, req: LinkRequest, password: string | undefined, log: DenyLogMode): Promise<void> {
  const hash = req.access.password_hash;
  if (hash === undefined) return;
  if (password === undefined) throw denial("password_required");
  const db = c.env.APP_DB;
  const claim = await claimPasswordAttempt(db, req.row.id, passwordIpBucket(req.client.ip), req.now);
  if (!claim.ok) return await rejectWith(c, req, "password_locked", log, { retry_after_at: claim.retryAfter });
  if (await verifyPassword(c.env, password, hash)) {
    await releasePasswordAttempt(db, claim.attemptId);
    return;
  }
  await rejectWith(c, req, "bad_password", log);
}
