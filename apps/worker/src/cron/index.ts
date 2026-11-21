import type { CronRun } from "@maillink/shared";
import { CRON_DAILY_CLEANUP, CRON_ERROR_MAX_LENGTH, CRON_PREWARM } from "../constants";
import { nowSec } from "../clock";
import { setLastRun } from "../db/cron-state";
import type { CronTaskName } from "../db/cron-state";
import { withReadonlyMailDb } from "../mail-source";
import { truncateChars } from "../text-utils";
import { runDailyCleanup } from "./cleanup";
import { isPrewarmDue, prewarmMailIndex } from "./prewarm";
import { CronTaskError, describeError } from "./types";
import type { CronEnv, Processed } from "./types";

type CronTask = {
  name: CronTaskName;
  /** 不给就每次触发都运行；返回 false 时本次跳过，也不写 last_run（last_run 只记真正运行过的） */
  isDue?: (db: D1Database, now: number) => Promise<boolean>;
  run: (env: CronEnv) => Promise<Processed>;
};

const TASKS: Record<string, CronTask> = {
  [CRON_PREWARM]: { name: "prewarm", isDue: isPrewarmDue, run: prewarmMailIndex },
  [CRON_DAILY_CLEANUP]: { name: "cleanup", run: (env) => runDailyCleanup(env) },
};

/**
 * 按 cron 表达式分派（`scheduled` 入口调用）。now 只用于判断任务是否到点（测试里可传入模拟时刻）。
 * 运行了的任务无论成败都把开始/结束时间、处理数量、错误写进 settings；失败时记录后原样抛出，
 * 让 Workers 的 cron 日志也能看到失败，不吞异常。
 */
export async function runScheduled(cron: string, env: CronEnv, now: number = nowSec()): Promise<void> {
  const task = TASKS[cron];
  if (!task) throw new Error(`未知的 cron 表达式：${cron}`);
  if (task.isDue !== undefined && !(await task.isDue(env.APP_DB, now))) return;
  await runAndRecord(task, env);
}

async function runAndRecord(task: CronTask, env: CronEnv): Promise<void> {
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
