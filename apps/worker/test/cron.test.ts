import { env } from "cloudflare:workers";
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { healthResponseSchema } from "@maillink/shared";
import {
  ACCESS_LOG_RETENTION_DAYS_DEFAULT,
  AUDIT_LOG_RETENTION_DAYS_DEFAULT,
  CRON_DAILY_CLEANUP,
  CRON_PREWARM,
  ORPHAN_SCAN_BATCH_SIZE,
  PREWARM_BATCH_SIZE,
  SESSION_IDLE_SEC,
} from "../src/constants";
import { runDailyCleanup } from "../src/cron/cleanup";
import { runScheduled } from "../src/cron";
import { getLastRun, getOrphanScanCursor, getPrewarmCursor } from "../src/db/cron-state";
import { insertAuditLog } from "../src/db/audit";
import worker from "../src/index";
import { adminSession, api, createUser, resetApp, setupMailDb } from "./helpers";
import { insertMail } from "./mail-helpers";

const DAY = 24 * 60 * 60;
const ADDRESS = "box@example.com";
const now = () => Math.floor(Date.now() / 1000);

async function addMailbox(address = ADDRESS, status: "active" | "disabled" = "active"): Promise<void> {
  await env.APP_DB
    .prepare("INSERT INTO mailboxes (address, address_lc, status, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 0)")
    .bind(address, address.toLowerCase(), status)
    .run();
}

const simpleMail = (subject: string, address = ADDRESS) =>
  insertMail({ address, raw: `From: a@example.org\r\nTo: ${address}\r\nSubject: ${subject}\r\n\r\nbody of ${subject}` });

async function indexedIds(): Promise<number[]> {
  const { results } = await env.APP_DB.prepare("SELECT mail_id FROM mail_index ORDER BY mail_id").all<{ mail_id: number }>();
  return results.map((row) => row.mail_id);
}

async function count(table: string): Promise<number> {
  return (await env.APP_DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0;
}

describe("scheduled 入口与分派", () => {
  beforeEach(resetApp);
  afterEach(() => vi.restoreAllMocks());

  it("通过 worker.scheduled 触发预热，并写入 last_run", async () => {
    await addMailbox();
    const id = await simpleMail("hello");
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: CRON_PREWARM }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await indexedIds()).toEqual([id]);
    const run = await getLastRun(env.APP_DB, "prewarm");
    expect(run).toMatchObject({ ok: true, error: null, processed: { candidates: 1, ok: 1 } });
    expect(run?.finished_at).toBeGreaterThanOrEqual(run?.started_at ?? Infinity);
  });

  it("未知的 cron 表达式：抛错，不假装成功", async () => {
    await expect(runScheduled("0 0 * * *", env)).rejects.toThrow("未知的 cron 表达式");
  });

  it("任务失败：console.error、写入 last_run.error，并把原错误抛出", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await addMailbox();
    await setupMailDb({ rawMails: false });
    await expect(runScheduled(CRON_PREWARM, env)).rejects.toThrow(/MAIL_DB/);
    expect(errorLog).toHaveBeenCalled();
    const run = await getLastRun(env.APP_DB, "prewarm");
    expect(run).toMatchObject({ ok: false });
    expect(run?.error).toContain("MAIL_DB");
  });
});

describe("预热 mail_index", () => {
  beforeEach(resetApp);

  it("没有启用的收件地址：什么都不做，不建游标", async () => {
    await addMailbox(ADDRESS, "disabled");
    await simpleMail("ignored");
    await runScheduled(CRON_PREWARM, env);
    expect(await indexedIds()).toEqual([]);
    expect(await getPrewarmCursor(env.APP_DB)).toBeNull();
    expect((await getLastRun(env.APP_DB, "prewarm"))?.processed).toMatchObject({ addresses: 0, candidates: 0 });
  });

  it("首次运行只取最近一批，游标推进到最大 id；之后只处理游标之后的新邮件", async () => {
    await addMailbox();
    const old: number[] = [];
    for (let i = 0; i < PREWARM_BATCH_SIZE + 3; i += 1) old.push(await simpleMail(`old ${i}`));
    await runScheduled(CRON_PREWARM, env);

    const newest = old[old.length - 1] ?? 0;
    expect(await getPrewarmCursor(env.APP_DB)).toBe(newest);
    const first = await indexedIds();
    expect(first).toHaveLength(PREWARM_BATCH_SIZE);
    expect(first[first.length - 1]).toBe(newest);

    const fresh = await simpleMail("fresh");
    await simpleMail("other box", "someone@else.org");
    await runScheduled(CRON_PREWARM, env);
    expect(await getPrewarmCursor(env.APP_DB)).toBe(fresh);
    expect((await indexedIds()).includes(fresh)).toBe(true);
    expect((await getLastRun(env.APP_DB, "prewarm"))?.processed).toMatchObject({ candidates: 1, ok: 1 });
  });

  it("积压超过一批：每次推进一批，不跳过邮件；不改 MAIL_DB", async () => {
    await addMailbox();
    await simpleMail("seed");
    await runScheduled(CRON_PREWARM, env);

    const ids: number[] = [];
    for (let i = 0; i < PREWARM_BATCH_SIZE + 5; i += 1) ids.push(await simpleMail(`m${i}`));
    const rawCount = (await env.MAIL_DB.prepare("SELECT COUNT(*) AS n FROM raw_mails").first<{ n: number }>())?.n;

    await runScheduled(CRON_PREWARM, env);
    expect(await getPrewarmCursor(env.APP_DB)).toBe(ids[PREWARM_BATCH_SIZE - 1]);
    await runScheduled(CRON_PREWARM, env);
    expect(await getPrewarmCursor(env.APP_DB)).toBe(ids[ids.length - 1]);
    expect(await indexedIds()).toEqual(expect.arrayContaining(ids));
    expect((await env.MAIL_DB.prepare("SELECT COUNT(*) AS n FROM raw_mails").first<{ n: number }>())?.n).toBe(rawCount);
  });

  it("解析失败的邮件记为 failed 但游标照常推进（不会卡死）", async () => {
    await addMailbox();
    await simpleMail("seed");
    await runScheduled(CRON_PREWARM, env);
    const broken = await insertMail({ address: ADDRESS, raw: null, raw_blob: null });
    await runScheduled(CRON_PREWARM, env);
    expect(await getPrewarmCursor(env.APP_DB)).toBe(broken);
    expect((await getLastRun(env.APP_DB, "prewarm"))?.processed).toMatchObject({ failed: 1 });
  });
});

describe("每日清理：会话", () => {
  beforeEach(resetApp);

  async function addSession(tag: string, lastSeenAt: number, expiresAt: number, userId: number, createdAt = now() - 20): Promise<void> {
    await env.APP_DB
      .prepare(
        "INSERT INTO sessions (id_hash, user_id, auth_methods, created_at, last_seen_at, expires_at) VALUES (?1, ?2, 'password', ?5, ?3, ?4)",
      )
      .bind(tag, userId, lastSeenAt, expiresAt, createdAt)
      .run();
  }

  it("删除绝对过期与空闲过期的会话（边界：恰好到期即删），保留有效会话", async () => {
    const userId = await createUser({ username: "u1" });
    const t = now();
    await addSession("valid", t - 10, t + 100, userId);
    await addSession("expires-now", t - 10, t, userId);
    await addSession("expires-next-sec", t - 10, t + 1, userId);
    await addSession("idle-exactly", t - SESSION_IDLE_SEC, t + 1000, userId);
    await addSession("idle-almost", t - SESSION_IDLE_SEC + 1, t + 1000, userId);
    await addSession("expired-long-ago", t - 10, t - DAY, userId);

    const processed = await runDailyCleanup(env, t);
    expect(processed.sessions_deleted).toBe(3);
    const { results } = await env.APP_DB.prepare("SELECT id_hash FROM sessions ORDER BY id_hash").all<{ id_hash: string }>();
    expect(results.map((row) => row.id_hash)).toEqual(["expires-next-sec", "idle-almost", "valid"]);
  });
});

describe("每日清理：日志保留", () => {
  beforeEach(resetApp);

  /** 访问日志要挂在取件链接上：先建规则组与链接（只在第一次） */
  async function ensureLink(): Promise<void> {
    await env.APP_DB
      .prepare("INSERT OR IGNORE INTO rule_groups (id, name, schema_version, config, created_at, updated_at) VALUES (1, 'g', 1, '{}', 0, 0)")
      .run();
    await env.APP_DB
      .prepare(
        "INSERT OR IGNORE INTO share_links (id, token_hash, token_enc, token_hint, rule_group_id, access, created_at, updated_at) VALUES (1, 'h', 'e', 'hint', 1, '{}', 0, 0)",
      )
      .run();
  }

  async function addAudit(createdAt: number): Promise<void> {
    await insertAuditLog(env.APP_DB, {
      actor_user_id: null, action: "x", target_type: null, target_id: null, detail: null, ip: null, created_at: createdAt,
    });
  }

  async function setSetting(key: string, value: number): Promise<void> {
    await env.APP_DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, 0)").bind(key, JSON.stringify(value)).run();
  }

  const times = async (table: string) =>
    (await env.APP_DB.prepare(`SELECT created_at FROM ${table} ORDER BY created_at`).all<{ created_at: number }>()).results.map(
      (row) => row.created_at,
    );

  it("默认保留天数：恰好在边界上的保留，早 1 秒的删除；两类日志各用各的默认值", async () => {
    const t = 2_000_000_000;
    const accessCutoff = t - ACCESS_LOG_RETENTION_DAYS_DEFAULT * DAY;
    const auditCutoff = t - AUDIT_LOG_RETENTION_DAYS_DEFAULT * DAY;
    for (const at of [accessCutoff - 1, accessCutoff, t]) await addAccessLogRow(at);
    for (const at of [auditCutoff - 1, auditCutoff, accessCutoff - 1, t]) await addAudit(at);

    const processed = await runDailyCleanup(env, t);
    expect(processed).toMatchObject({ access_logs_deleted: 1, audit_logs_deleted: 1 });
    expect(await times("link_access_logs")).toEqual([accessCutoff, t]);
    expect(await times("audit_logs")).toEqual([auditCutoff, accessCutoff - 1, t].sort((a, b) => a - b));
  });

  it("系统设置里的保留天数覆盖默认值", async () => {
    const t = 2_000_000_000;
    await setSetting("logs.access_retention_days", 7);
    await setSetting("logs.audit_retention_days", 30);
    for (const at of [t - 7 * DAY - 1, t - 7 * DAY]) await addAccessLogRow(at);
    for (const at of [t - 30 * DAY - 1, t - 30 * DAY]) await addAudit(at);

    await runDailyCleanup(env, t);
    expect(await times("link_access_logs")).toEqual([t - 7 * DAY]);
    expect(await times("audit_logs")).toEqual([t - 30 * DAY]);
  });

  it("保留天数被改坏（非正整数）：清理失败并记录错误，不按默认值悄悄继续删", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await setSetting("logs.audit_retention_days", 0);
    await addAudit(1);
    await expect(runDailyCleanup(env, 2_000_000_000)).rejects.toThrow(/logs/);
    expect(await count("audit_logs")).toBe(1);
  });

  async function addAccessLogRow(createdAt: number): Promise<void> {
    await ensureLink();
    await env.APP_DB
      .prepare("INSERT INTO link_access_logs (link_id, event, created_at) VALUES (1, 'start', ?1)")
      .bind(createdAt)
      .run();
  }

});

describe("每日清理：mail_index 孤儿", () => {
  beforeEach(resetApp);
  afterEach(() => vi.restoreAllMocks());

  it("删除 MAIL_DB 里已不存在的行，保留仍存在的；不改 MAIL_DB", async () => {
    await addMailbox();
    const keep = await simpleMail("keep");
    const gone = await simpleMail("gone");
    await runScheduled(CRON_PREWARM, env);
    expect(await indexedIds()).toEqual([keep, gone]);

    await env.MAIL_DB.prepare("DELETE FROM raw_mails WHERE id = ?1").bind(gone).run();
    const processed = await runDailyCleanup(env, now());
    expect(processed).toMatchObject({ mail_index_scanned: 2, mail_index_orphans_deleted: 1 });
    expect(await indexedIds()).toEqual([keep]);
    expect((await env.MAIL_DB.prepare("SELECT COUNT(*) AS n FROM raw_mails").first<{ n: number }>())?.n).toBe(1);
    expect(await getOrphanScanCursor(env.APP_DB)).toBe(0);
  });

  it("超过一批的行分批扫描并跨批删除", async () => {
    await addMailbox();
    const total = ORPHAN_SCAN_BATCH_SIZE + 10;
    const rows = Array.from({ length: total }, (_, i) =>
      env.APP_DB
        .prepare(
          "INSERT INTO mail_index (mail_id, received_at, recipient, parse_status, parser_version, indexed_at) VALUES (?1, 0, ?2, 'ok', 1, 0)",
        )
        .bind(i + 1, ADDRESS),
    );
    await env.APP_DB.batch(rows);
    // MAIL_DB 里只有 id 1 与 total 存在
    await env.MAIL_DB.batch([1, total].map((id) => env.MAIL_DB.prepare("INSERT INTO raw_mails (id, address) VALUES (?1, ?2)").bind(id, ADDRESS)));

    const processed = await runDailyCleanup(env, now());
    expect(processed).toMatchObject({ mail_index_scanned: total, mail_index_orphans_deleted: total - 2 });
    expect(await indexedIds()).toEqual([1, total]);
  });

  it("MAIL_DB 不健康：不删索引，错误被记录并抛出，其他步骤照常完成", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const userId = await createUser({ username: "u" });
    await env.APP_DB
      .prepare("INSERT INTO sessions (id_hash, user_id, auth_methods, created_at, last_seen_at, expires_at) VALUES ('old', ?1, 'password', 0, 0, 1)")
      .bind(userId)
      .run();
    await env.APP_DB
      .prepare("INSERT INTO mail_index (mail_id, received_at, recipient, parse_status, parser_version, indexed_at) VALUES (5, 0, ?1, 'ok', 1, 0)")
      .bind(ADDRESS)
      .run();
    await setupMailDb({ rawMails: false });

    await expect(runScheduled(CRON_DAILY_CLEANUP, env)).rejects.toThrow(/mail_index_orphans/);
    expect(await indexedIds()).toEqual([5]);
    expect(await count("sessions")).toBe(0);
    const run = await getLastRun(env.APP_DB, "cleanup");
    expect(run).toMatchObject({ ok: false, processed: { sessions_deleted: 1 } });
    expect(run?.error).toContain("mail_index_orphans");
  });
});

describe("health 的 cron 状态", () => {
  beforeEach(resetApp);

  it("从未运行为 null；运行后显示 last_run（含失败）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cookie } = await adminSession();
    const read = async () => healthResponseSchema.parse(await (await api("/api/admin/system/health", { cookie })).json()).cron;
    expect(await read()).toEqual({ prewarm: null, cleanup: null });

    await runScheduled(CRON_DAILY_CLEANUP, env);
    const afterCleanup = await read();
    expect(afterCleanup.prewarm).toBeNull();
    expect(afterCleanup.cleanup).toMatchObject({ ok: true, error: null });

    await addMailbox();
    await setupMailDb({ rawMails: false });
    await expect(runScheduled(CRON_PREWARM, env)).rejects.toThrow();
    expect((await read()).prewarm).toMatchObject({ ok: false });
  });
});
