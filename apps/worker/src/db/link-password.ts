import { parseIp, unmapIpv4 } from "@maillink/shared";
import {
  LINK_PASSWORD_FAILURE_WINDOW_SEC,
  LINK_PASSWORD_INFLIGHT_TTL_SEC,
  LINK_PASSWORD_IPV6_BUCKET_BYTES,
  LINK_PASSWORD_MAX_FAILURES,
  LINK_PASSWORD_MAX_FAILURES_PER_LINK,
  LINK_PASSWORD_MAX_INFLIGHT,
  LINK_PASSWORD_MAX_INFLIGHT_PER_LINK,
  LINK_PASSWORD_UNKNOWN_IP_BUCKET,
} from "../constants";

// 访问口令的校验名额（迁移 0006 / 0011）。两张表：
//   - link_password_attempts：已失败的校验，按"链接 + IP 桶""链接全局"两层上限锁定；
//   - link_password_inflight：进行中的校验（PBKDF2 期间），结束即删，expires_at 兜底。
// PBKDF2 之前用一条带条件的 INSERT 占"进行中"名额：D1 对同一个库串行执行语句，计数判断与写入在同一条语句里。
// 条件同时看失败数（已锁定就不占）与进行中数（满了就 busy）。进行中的不计入失败，
// 因此锁定前最多能试"失败上限 + 进行中上限"次（见 constants.ts LINK_PASSWORD_MAX_INFLIGHT）。

/** IPv4 原样；IPv6 合并到 /64（IPv4 映射地址按 IPv4）；拿不到或解析不了的 IP 共用 unknown 桶 */
export function passwordIpBucket(ip: string | null): string {
  const parsed = ip === null ? null : parseIp(ip);
  if (parsed === null) return LINK_PASSWORD_UNKNOWN_IP_BUCKET;
  const normalized = unmapIpv4(parsed);
  if (normalized.version === 4) return normalized.bytes.join(".");
  const prefix = Array.from(normalized.bytes.slice(0, LINK_PASSWORD_IPV6_BUCKET_BYTES), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}::/64`;
}

export type PasswordCheckClaim =
  | { kind: "claimed"; id: number }
  /** 失败数已满：大约何时解锁 */
  | { kind: "locked"; retryAfter: number }
  /** 进行中的校验已满：稍后重试，不锁定 */
  | { kind: "busy" };

/** PBKDF2 之前占一个"进行中"名额；已锁定或进行中已满时不占 */
export async function claimPasswordCheck(db: D1Database, linkId: number, bucket: string, now: number): Promise<PasswordCheckClaim> {
  const since = now - LINK_PASSWORD_FAILURE_WINDOW_SEC;
  const row = await db
    .prepare(
      `INSERT INTO link_password_inflight (link_id, ip_bucket, expires_at)
       SELECT ?1, ?2, ?3 + ?9
       WHERE (SELECT COUNT(*) FROM link_password_attempts WHERE link_id = ?1 AND ip_bucket = ?2 AND created_at > ?4) < ?5
         AND (SELECT COUNT(*) FROM link_password_attempts WHERE link_id = ?1 AND created_at > ?4) < ?6
         AND (SELECT COUNT(*) FROM link_password_inflight WHERE link_id = ?1 AND ip_bucket = ?2 AND expires_at > ?3) < ?7
         AND (SELECT COUNT(*) FROM link_password_inflight WHERE link_id = ?1 AND expires_at > ?3) < ?8
       RETURNING id`,
    )
    .bind(
      linkId,
      bucket,
      now,
      since,
      LINK_PASSWORD_MAX_FAILURES,
      LINK_PASSWORD_MAX_FAILURES_PER_LINK,
      LINK_PASSWORD_MAX_INFLIGHT,
      LINK_PASSWORD_MAX_INFLIGHT_PER_LINK,
      LINK_PASSWORD_INFLIGHT_TTL_SEC,
    )
    .first<{ id: number }>();
  if (row !== null) return { kind: "claimed", id: row.id };
  return await refusal(db, linkId, bucket, since);
}

/** 没占到：失败数满了是锁定，否则是进行中满了 */
async function refusal(db: D1Database, linkId: number, bucket: string, since: number): Promise<PasswordCheckClaim> {
  const stats = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM link_password_attempts WHERE link_id = ?1 AND ip_bucket = ?2 AND created_at > ?3) AS ip_count,
         (SELECT COUNT(*) FROM link_password_attempts WHERE link_id = ?1 AND created_at > ?3) AS link_count,
         (SELECT MIN(created_at) FROM link_password_attempts WHERE link_id = ?1 AND ip_bucket = ?2 AND created_at > ?3) AS ip_oldest,
         (SELECT MIN(created_at) FROM link_password_attempts WHERE link_id = ?1 AND created_at > ?3) AS link_oldest`,
    )
    .bind(linkId, bucket, since)
    .first<FailureStats>();
  if (stats === null) throw new Error("link_password_attempts 统计查询没有返回行");
  return lockState(stats, since);
}

type FailureStats = { ip_count: number; link_count: number; ip_oldest: number | null; link_oldest: number | null };

function lockState(stats: FailureStats, since: number): PasswordCheckClaim {
  const ipLocked = stats.ip_count >= LINK_PASSWORD_MAX_FAILURES;
  if (!ipLocked && stats.link_count < LINK_PASSWORD_MAX_FAILURES_PER_LINK) return { kind: "busy" };
  // 触发上限那一层里最早一次失败 + 窗口
  const oldest = (ipLocked ? stats.ip_oldest : stats.link_oldest) ?? since;
  return { kind: "locked", retryAfter: oldest + LINK_PASSWORD_FAILURE_WINDOW_SEC };
}

/** 校验结束（成功、失败、异常）都要调用：删掉进行中占位；failed 时同一批里记一次失败 */
export async function settlePasswordCheck(
  db: D1Database,
  claimId: number,
  failure: { linkId: number; bucket: string; now: number } | null,
): Promise<void> {
  const release = db.prepare("DELETE FROM link_password_inflight WHERE id = ?").bind(claimId);
  if (failure === null) {
    await release.run();
    return;
  }
  await db.batch([
    db.prepare("INSERT INTO link_password_attempts (link_id, ip_bucket, created_at) VALUES (?, ?, ?)").bind(failure.linkId, failure.bucket, failure.now),
    release,
  ]);
}
