import type { Bindings } from "../env";
import type { MailDbBinding } from "../mail-source";

/** 定时任务只用到两个库 */
export type CronEnv = Pick<Bindings, "APP_DB"> & MailDbBinding;

/** 各项处理数量，写进 last_run.processed */
export type Processed = Record<string, number>;

/** 任务部分失败：携带已完成部分的统计，让 last_run 同时记下进度与错误 */
export class CronTaskError extends Error {
  constructor(
    message: string,
    readonly processed: Processed,
  ) {
    super(message);
    this.name = "CronTaskError";
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
