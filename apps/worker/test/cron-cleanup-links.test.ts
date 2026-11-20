import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLEANUP_DELETE_BATCH_SIZE, CLEANUP_MAX_BATCHES, CRON_DAILY_CLEANUP, LINK_PASSWORD_FAILURE_WINDOW_SEC } from "../src/constants";
import { runDailyCleanup } from "../src/cron/cleanup";
import { runScheduled } from "../src/cron";
import { CronTaskError } from "../src/cron/types";
import { getLastRun } from "../src/db/cron-state";
import { resetApp } from "./helpers";

// 每日清理：口令失败名额（link_password_attempts）与过期的一次性流程令牌（auth_flow_tokens）。

const T = 2_000_000_000;

beforeEach(async () => {
  await resetApp();
  await env.APP_DB
    .prepare("INSERT INTO rule_groups (id, name, schema_version, config, created_at, updated_at) VALUES (1, 'g', 1, '{}', 0, 0)")
    .run();
  await env.APP_DB
    .prepare("INSERT INTO share_links (id, token_hash, token_enc, token_hint, rule_group_id, access, created_at, updated_at) VALUES (1, 'h', 'e', 'hint', 1, '{}', 0, 0)")
    .run();
});
afterEach(() => vi.restoreAllMocks());

async function addAttempts(...createdAt: number[]): Promise<void> {
  for (const at of createdAt) {
    await env.APP_DB.prepare("INSERT INTO link_password_attempts (link_id, ip_bucket, created_at) VALUES (1, '203.0.113.7', ?1)").bind(at).run();
  }
}

async function addTokens(...expiresAt: number[]): Promise<void> {
  for (const [index, at] of expiresAt.entries()) {
    await env.APP_DB
      .prepare("INSERT INTO auth_flow_tokens (jti, purpose, attempts, consumed_at, expires_at) VALUES (?1, 'oauth_flow', 0, NULL, ?2)")
      .bind(`jti-${index}-${at}`, at)
      .run();
  }
}

/** 一条语句造出大量行（避免在测试里循环插入几万次） */
async function bulkExpiredTokens(count: number): Promise<void> {
  await env.APP_DB
    .prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
       INSERT INTO auth_flow_tokens (jti, purpose, attempts, consumed_at, expires_at) SELECT 'bulk-' || i, 'oauth_flow', 0, NULL, 1 FROM n`,
    )
    .bind(count)
    .run();
}

const column = async (table: string, name: string): Promise<number[]> =>
  (await env.APP_DB.prepare(`SELECT ${name} AS v FROM ${table} ORDER BY ${name}`).all<{ v: number }>()).results.map((row) => row.v);
const count = async (table: string) => (await column(table, "rowid")).length;

describe("link_password_attempts", () => {
  it("早于口令计数窗口的行删除；恰在窗口起点与窗口内的保留", async () => {
    const cutoff = T - LINK_PASSWORD_FAILURE_WINDOW_SEC;
    await addAttempts(cutoff - 1, cutoff, cutoff + 1, T);
    const processed = await runDailyCleanup(env, T);
    expect(processed.link_password_attempts_deleted).toBe(1);
    expect(await column("link_password_attempts", "created_at")).toEqual([cutoff, cutoff + 1, T]);
  });

  it("没有可删的行：计数为 0", async () => {
    await addAttempts(T);
    expect((await runDailyCleanup(env, T)).link_password_attempts_deleted).toBe(0);
    expect(await count("link_password_attempts")).toBe(1);
  });
});

describe("auth_flow_tokens", () => {
  it("已过期的删除（expires_at <= now，与 purgeExpired 同口径）；未过期的保留", async () => {
    await addTokens(T - 1, T, T + 1);
    const processed = await runDailyCleanup(env, T);
    expect(processed.auth_flow_tokens_deleted).toBe(2);
    expect(await column("auth_flow_tokens", "expires_at")).toEqual([T + 1]);
  });

  it("超过一批的行分批删除", async () => {
    await bulkExpiredTokens(CLEANUP_DELETE_BATCH_SIZE + 5);
    await addTokens(T + 100);
    const processed = await runDailyCleanup(env, T);
    expect(processed.auth_flow_tokens_deleted).toBe(CLEANUP_DELETE_BATCH_SIZE + 5);
    expect(await column("auth_flow_tokens", "expires_at")).toEqual([T + 100]);
  });

  it("单次运行有批数上限：删到上限为止，其余留给下一次", async () => {
    const cap = CLEANUP_MAX_BATCHES * CLEANUP_DELETE_BATCH_SIZE;
    await bulkExpiredTokens(cap + 5);
    expect((await runDailyCleanup(env, T)).auth_flow_tokens_deleted).toBe(cap);
    expect(await count("auth_flow_tokens")).toBe(5);
    expect((await runDailyCleanup(env, T)).auth_flow_tokens_deleted).toBe(5);
  });
});

describe("步骤隔离与 last_run", () => {
  it("定时入口写入 last_run.processed", async () => {
    await addAttempts(1);
    await addTokens(1);
    await runScheduled(CRON_DAILY_CLEANUP, env);
    expect((await getLastRun(env.APP_DB, "cleanup"))?.processed).toMatchObject({ link_password_attempts_deleted: 1, auth_flow_tokens_deleted: 1 });
  });

  it("一步失败不影响其他步骤：错误聚合并带上已完成的统计", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await addAttempts(1);
    await env.APP_DB.prepare("DROP TABLE auth_flow_tokens").run();
    const error = await runDailyCleanup(env, T).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(CronTaskError);
    expect((error as CronTaskError).message).toContain("auth_flow_tokens");
    expect((error as CronTaskError).processed).toMatchObject({ link_password_attempts_deleted: 1 });
    expect(await count("link_password_attempts")).toBe(0);
  });
});
