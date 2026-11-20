import type { CronRun } from "@maillink/shared";
import { CRON_DAILY_CLEANUP, CRON_ERROR_MAX_LENGTH, CRON_PREWARM } from "../constants";
import { nowSec } from "../clock";
import { setLastRun } from "../db/cron-state";
import type { CronTaskName } from "../db/cron-state";
import { withReadonlyMailDb } from "../mail-source";
import { truncateChars } from "../text-utils";
import { runDailyCleanup } from "./cleanup";
import { prewarmMailIndex } from "./prewarm";
import { CronTaskError, describeError } from "./types";
import type { CronEnv, Processed } from "./types";

const TASKS: Record<string, { name: CronTaskName; run: (env: CronEnv) => Promise<Processed> }> = {
  [CRON_PREWARM]: { name: "prewarm", run: prewarmMailIndex },
  [CRON_DAILY_CLEANUP]: { name: "cleanup", run: (env) => runDailyCleanup(env) },
};

/**
 * 按 cron 表达式分派（`scheduled` 入口调用）。
 * 无论成败都把开始/结束时间、处理数量、错误写进 settings；失败时记录后原样抛出，
 * 让 Workers 的 cron 日志也能看到失败，不吞异常。
 */
export async function runScheduled(cron: string, env: CronEnv): Promise<void> {
  const task = TASKS[cron];
  if (!task) throw new Error(`未知的 cron 表达式：${cron}`);

  const startedAt = nowSec();
  let processed: Processed = {};
  let failure: unknown = null;
  try {
    // MAIL_DB 运行时只读包装（见 mail-source/readonly-db.ts），scheduled 入口与直接调用都经过这里
    processed = await task.run(withReadonlyMailDb(env));
  } catch (error) {
    console.error(`cron 任务 ${task.name} 失败`, error);
    failure = error;
    if (error instanceof CronTaskError) processed = error.processed;
  }

  const run: CronRun = {
    started_at: startedAt,
    finished_at: nowSec(),
    ok: failure === null,
    processed,
    error: failure === null ? null : truncateChars(describeError(failure), CRON_ERROR_MAX_LENGTH),
  };
  try {
    await setLastRun(env.APP_DB, task.name, run);
  } catch (recordError) {
    console.error(`cron 任务 ${task.name} 的运行记录写入失败`, recordError);
    // 任务本身已失败时抛任务的错误（更重要），否则抛记录失败
    throw failure ?? recordError;
  }
  if (failure !== null) throw failure;
}
