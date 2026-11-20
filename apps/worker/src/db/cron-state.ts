import { cronRunSchema } from "@maillink/shared";
import type { CronRun } from "@maillink/shared";
import { z } from "zod";
import { CRON_SETTING_KEYS } from "../constants";
import { nowSec } from "../clock";

// 定时任务的游标与运行记录，都存在 settings 表里（值是 JSON 文本）。
// 值不符合 schema 说明数据被改坏，直接抛错（与 db/settings.ts 一致）。

const cursorSchema = z.number().int().nonnegative();

export type CronTaskName = "prewarm" | "cleanup";

const LAST_RUN_KEYS: Record<CronTaskName, string> = {
  prewarm: CRON_SETTING_KEYS.lastRunPrewarm,
  cleanup: CRON_SETTING_KEYS.lastRunCleanup,
};

async function readSetting<S extends z.ZodType>(db: D1Database, key: string, schema: S): Promise<z.output<S> | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?1").bind(key).first<{ value: string }>();
  return row === null ? null : schema.parse(JSON.parse(row.value));
}

async function writeSetting(db: D1Database, key: string, value: unknown): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, NULL)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, JSON.stringify(value), nowSec())
    .run();
}

/** 预热游标：已预热的最大 mail_id；从未预热过为 null */
export function getPrewarmCursor(db: D1Database): Promise<number | null> {
  return readSetting(db, CRON_SETTING_KEYS.prewarmCursor, cursorSchema);
}

export function setPrewarmCursor(db: D1Database, mailId: number): Promise<void> {
  return writeSetting(db, CRON_SETTING_KEYS.prewarmCursor, mailId);
}

/** 孤儿索引扫描游标：已检查到的 mail_index.mail_id；null 等同于从头开始 */
export function getOrphanScanCursor(db: D1Database): Promise<number | null> {
  return readSetting(db, CRON_SETTING_KEYS.orphanScanCursor, cursorSchema);
}

export function setOrphanScanCursor(db: D1Database, mailId: number): Promise<void> {
  return writeSetting(db, CRON_SETTING_KEYS.orphanScanCursor, mailId);
}

export function getLastRun(db: D1Database, task: CronTaskName): Promise<CronRun | null> {
  return readSetting(db, LAST_RUN_KEYS[task], cronRunSchema);
}

export function setLastRun(db: D1Database, task: CronTaskName, run: CronRun): Promise<void> {
  return writeSetting(db, LAST_RUN_KEYS[task], run);
}
