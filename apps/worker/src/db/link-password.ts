import { parseIp, unmapIpv4 } from "@maillink/shared";
import {
  LINK_PASSWORD_FAILURE_WINDOW_SEC,
  LINK_PASSWORD_IPV6_BUCKET_BYTES,
  LINK_PASSWORD_MAX_FAILURES,
  LINK_PASSWORD_MAX_FAILURES_PER_LINK,
  LINK_PASSWORD_UNKNOWN_IP_BUCKET,
} from "../constants";

// 访问口令的失败名额（link_password_attempts）。PBKDF2 之前先用一条带条件的 INSERT 占名额：
// D1 对同一个库串行执行语句，计数判断与写入在同一条语句里，并发的错口令请求最多只有"上限"个能进入 PBKDF2。
// 两层上限：同一链接 + 同一 IP 桶；同一链接全局（对所有新设备生效）。口令正确时删掉自己的占位。

/** IPv4 原样；IPv6 合并到 /64（IPv4 映射地址按 IPv4）；拿不到或解析不了的 IP 共用 unknown 桶 */
export function passwordIpBucket(ip: string | null): string {
  const parsed = ip === null ? null : parseIp(ip);
  if (parsed === null) return LINK_PASSWORD_UNKNOWN_IP_BUCKET;
  const normalized = unmapIpv4(parsed);
  if (normalized.version === 4) return normalized.bytes.join(".");
  const prefix = Array.from(normalized.bytes.slice(0, LINK_PASSWORD_IPV6_BUCKET_BYTES), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}::/64`;
}

export type PasswordClaim = { ok: true; attemptId: number } | { ok: false; retryAfter: number };

/** 占一个失败名额；满了返回大约何时解锁（触发上限那一层里最早一次 + 窗口） */
export async function claimPasswordAttempt(db: D1Database, linkId: number, bucket: string, now: number): Promise<PasswordClaim> {
  const since = now - LINK_PASSWORD_FAILURE_WINDOW_SEC;
  const row = await db
    .prepare(
      `INSERT INTO link_password_attempts (link_id, ip_bucket, created_at)
       SELECT ?1, ?2, ?3
       WHERE (SELECT COUNT(*) FROM link_password_attempts WHERE link_id = ?1 AND ip_bucket = ?2 AND created_at > ?4) < ?5
         AND (SELECT COUNT(*) FROM link_password_attempts WHERE link_id = ?1 AND created_at > ?4) < ?6
       RETURNING id`,
    )
    .bind(linkId, bucket, now, since, LINK_PASSWORD_MAX_FAILURES, LINK_PASSWORD_MAX_FAILURES_PER_LINK)
    .first<{ id: number }>();
  if (row !== null) return { ok: true, attemptId: row.id };
  return { ok: false, retryAfter: await lockedUntil(db, linkId, bucket, since) };
}

async function lockedUntil(db: D1Database, linkId: number, bucket: string, since: number): Promise<number> {
  const stats = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM link_password_attempts WHERE link_id = ?1 AND ip_bucket = ?2 AND created_at > ?3) AS ip_count,
         (SELECT MIN(created_at) FROM link_password_attempts WHERE link_id = ?1 AND ip_bucket = ?2 AND created_at > ?3) AS ip_oldest,
         (SELECT MIN(created_at) FROM link_password_attempts WHERE link_id = ?1 AND created_at > ?3) AS link_oldest`,
    )
    .bind(linkId, bucket, since)
    .first<{ ip_count: number; ip_oldest: number | null; link_oldest: number | null }>();
  const ipLocked = (stats?.ip_count ?? 0) >= LINK_PASSWORD_MAX_FAILURES;
  const oldest = (ipLocked ? stats?.ip_oldest : stats?.link_oldest) ?? since;
  return oldest + LINK_PASSWORD_FAILURE_WINDOW_SEC;
}

/** 口令正确：释放占位，不计入失败 */
export async function releasePasswordAttempt(db: D1Database, attemptId: number): Promise<void> {
  await db.prepare("DELETE FROM link_password_attempts WHERE id = ?").bind(attemptId).run();
}
