import { CLEANUP_DELETE_BATCH_SIZE, CLEANUP_MAX_BATCHES, LINK_PASSWORD_FAILURE_WINDOW_SEC } from "../constants";
import { sessionLimits } from "../auth/session";
import { getSettings } from "../db/settings";
import { nowSec } from "../clock";
import { cleanOrphanIndexRows } from "./orphans";
import { CronTaskError, describeError } from "./types";
import type { CronEnv, Processed } from "./types";

// 每日清理（01 §2 cron、03 §7）：过期会话、过期日志、口令失败名额、过期的一次性流程令牌、MAIL_DB 里已不存在的索引行。

const SECONDS_PER_DAY = 24 * 60 * 60;

/** 与 auth/session.ts 的 sessionExpired 同一套条件（时长读系统设置）：空闲过期、expires_at 到期、创建时间 + 绝对时长到期任一满足即删除 */
async function deleteExpiredSessions(db: D1Database, now: number): Promise<number> {
  const { idleSec, absoluteSec } = await sessionLimits(db);
  const result = await db
    .prepare("DELETE FROM sessions WHERE expires_at <= ?1 OR last_seen_at + ?2 <= ?1 OR created_at + ?3 <= ?1")
    .bind(now, idleSec, absoluteSec)
    .run();
  return result.meta.changes;
}

/** 可分批清理的表与"该删"的条件（?1 = 界线）。表名与条件都是这里写死的常量，不含外部输入 */
const CLEANUP_CONDITIONS = {
  link_access_logs: "created_at < ?1",
  audit_logs: "created_at < ?1",
  link_password_attempts: "created_at < ?1",
  // 与 db/flow-tokens.ts 的 purgeExpired 同一口径：expires_at <= now 即过期
  auth_flow_tokens: "expires_at <= ?1",
} as const;

type CleanupTable = keyof typeof CLEANUP_CONDITIONS;

/** 按条件分批删除（用 rowid，auth_flow_tokens 的主键是 jti 而不是 id），单次运行有批数上限 */
async function deleteInBatches(db: D1Database, table: CleanupTable, cutoff: number): Promise<number> {
  const condition = CLEANUP_CONDITIONS[table];
  let total = 0;
  for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch += 1) {
    const result = await db
      .prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${condition} ORDER BY rowid LIMIT ?2)`)
      .bind(cutoff, CLEANUP_DELETE_BATCH_SIZE)
      .run();
    total += result.meta.changes;
    if (result.meta.changes < CLEANUP_DELETE_BATCH_SIZE) break;
  }
  return total;
}

/** 口令失败名额只在计数窗口内有意义：早于窗口的行（等于窗口起点的保留）已不参与计数 */
async function cleanPasswordAttempts(db: D1Database, now: number): Promise<Processed> {
  return { link_password_attempts_deleted: await deleteInBatches(db, "link_password_attempts", now - LINK_PASSWORD_FAILURE_WINDOW_SEC) };
}

async function cleanFlowTokens(db: D1Database, now: number): Promise<Processed> {
  return { auth_flow_tokens_deleted: await deleteInBatches(db, "auth_flow_tokens", now) };
}

async function cleanExpiredLogs(db: D1Database, now: number): Promise<Processed> {
  const days = await getSettings(db, ["logs.access_retention_days", "logs.audit_retention_days"]);
  return {
    access_logs_deleted: await deleteInBatches(db, "link_access_logs", now - days["logs.access_retention_days"] * SECONDS_PER_DAY),
    audit_logs_deleted: await deleteInBatches(db, "audit_logs", now - days["logs.audit_retention_days"] * SECONDS_PER_DAY),
  };
}

/**
 * 各步骤互相独立：一步失败不影响其他步骤（例如 MAIL_DB 不可用时仍清理会话）。
 * 有失败时在最后抛出，并带上已完成部分的统计，由调用方记录到 last_run 并让 Workers 也记一次失败。
 */
export async function runDailyCleanup(env: CronEnv, now: number = nowSec()): Promise<Processed> {
  const steps: Array<[string, () => Promise<Processed>]> = [
    ["sessions", async () => ({ sessions_deleted: await deleteExpiredSessions(env.APP_DB, now) })],
    ["logs", () => cleanExpiredLogs(env.APP_DB, now)],
    ["link_password_attempts", () => cleanPasswordAttempts(env.APP_DB, now)],
    ["auth_flow_tokens", () => cleanFlowTokens(env.APP_DB, now)],
    ["mail_index_orphans", () => cleanOrphanIndexRows(env)],
  ];
  const processed: Processed = {};
  const errors: string[] = [];
  for (const [name, run] of steps) {
    try {
      Object.assign(processed, await run());
    } catch (error) {
      console.error(`cron 每日清理：步骤 ${name} 失败`, error);
      errors.push(`${name}: ${describeError(error)}`);
    }
  }
  if (errors.length > 0) throw new CronTaskError(errors.join("; "), processed);
  return processed;
}
