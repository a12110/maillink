import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mailDbCompatSchema, setupStatusSchema } from "@maillink/shared";
import type { Bindings } from "../src/env";
import { MAIL_SCHEMA_DEGRADED_CACHE_TTL_SEC } from "../src/constants";
import { getMailSchema, listCandidates } from "../src/mail-source";
import { WARNING_NO_TO_ADDRESS } from "../src/mail-source/schema-probe";
import { adminSession, api, createUser, createSessionCookie, resetApp, setupMailDb } from "./helpers";

// temp_email 版本兼容提示：GET /api/setup/status 的 mail_db（仅 needs_setup=true）与管理员接口 GET /api/admin/system/mail-db

const SETUP_STATUS = "/api/setup/status";
const MAIL_DB_PATH = "/api/admin/system/mail-db";

/** 记录经它 prepare 的 SQL；其余原样转给真实 MAIL_DB */
function countingMailDb(): { db: D1Database; queries: string[] } {
  const queries: string[] = [];
  const db = {
    prepare: (query: string) => {
      queries.push(query);
      return env.MAIL_DB.prepare(query);
    },
  } as unknown as D1Database;
  return { db, queries };
}

function throwingMailDb(message: string): D1Database {
  return {
    prepare: () => {
      throw new Error(message);
    },
  } as unknown as D1Database;
}

async function setupBody(bindings?: Partial<Bindings>) {
  const res = await api(SETUP_STATUS, bindings ? { bindings } : {});
  return { res, body: setupStatusSchema.parse(await res.json()) };
}

describe("GET /api/setup/status 的 mail_db（needs_setup=true）", () => {
  beforeEach(async () => {
    await resetApp();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("健康库（含 to_address）：ok", async () => {
    const { res, body } = await setupBody();
    expect(res.status).toBe(200);
    expect(body).toEqual({ needs_setup: true, mail_db: { status: "ok", db_version: "v0.0.11", missing_required: [] } });
  });

  it("缺 to_address：no_icloud，db_version 仍返回", async () => {
    await setupMailDb({ omitColumns: ["to_address"] });
    const { res, body } = await setupBody();
    expect(res.status).toBe(200);
    expect(body).toEqual({ needs_setup: true, mail_db: { status: "no_icloud", db_version: "v0.0.11", missing_required: [] } });
  });

  it("缺必需列：unhealthy，列出缺失的列", async () => {
    await setupMailDb({ omitColumns: ["created_at"] });
    const { res, body } = await setupBody();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ needs_setup: true, mail_db: { status: "unhealthy", missing_required: ["created_at"] } });
  });

  it("raw_mails 不存在：unhealthy，缺失列为全部必需列", async () => {
    await setupMailDb({ rawMails: false });
    const { body } = await setupBody();
    expect(body).toMatchObject({
      needs_setup: true,
      mail_db: { status: "unhealthy", missing_required: ["id", "source", "address", "raw", "created_at"] },
    });
  });

  it("MAIL_DB 绑定缺失：probe_failed + binding_missing，状态接口仍 200，并记日志", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, body } = await setupBody({ MAIL_DB: undefined as unknown as D1Database });
    expect(res.status).toBe(200);
    expect(body).toEqual({
      needs_setup: true,
      mail_db: { status: "probe_failed", db_version: null, missing_required: [], error_code: "binding_missing" },
    });
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("MAIL_DB"));
  });

  it("探测查询抛错：probe_failed + query_failed，状态接口仍 200，原始报错写日志、不进响应", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, body } = await setupBody({ MAIL_DB: throwingMailDb("D1 unreachable (synthetic)") });
    expect(res.status).toBe(200);
    expect(body).toEqual({
      needs_setup: true,
      mail_db: { status: "probe_failed", db_version: null, missing_required: [], error_code: "query_failed" },
    });
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("MAIL_DB"), expect.any(Error));
  });

  it("每次都重探：迁移补上 to_address 后立刻刷新即得 ok，不吃 isolate 缓存", async () => {
    await setupMailDb({ omitColumns: ["to_address"] });
    expect((await setupBody()).body).toMatchObject({ mail_db: { status: "no_icloud" } });
    await setupMailDb();
    expect((await setupBody()).body).toMatchObject({ mail_db: { status: "ok" } });
    // 不重置缓存直接换表结构（模拟管理员刚执行完迁移）
    await env.MAIL_DB.prepare("ALTER TABLE raw_mails DROP COLUMN to_address").run();
    expect((await setupBody()).body).toMatchObject({ mail_db: { status: "no_icloud" } });
  });
});

describe("GET /api/setup/status（needs_setup=false）", () => {
  beforeEach(async () => {
    await resetApp();
    await createUser({ username: "root", role: "admin" });
  });

  it("不含 mail_db，且不发起任何 MAIL_DB 查询", async () => {
    const { db, queries } = countingMailDb();
    const res = await api(SETUP_STATUS, { bindings: { MAIL_DB: db } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ needs_setup: false });
    expect(queries).toEqual([]);
  });

  it("MAIL_DB 绑定缺失也不影响：照常 200，不记探测错误", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await api(SETUP_STATUS, { bindings: { MAIL_DB: undefined as unknown as D1Database } });
    expect(await res.json()).toEqual({ needs_setup: false });
    expect(errorLog).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("对照：needs_setup=true 时同样的计数包装确实收到了查询（证明上面的断言有效）", async () => {
    await env.APP_DB.prepare("DELETE FROM users").run();
    const { db, queries } = countingMailDb();
    await api(SETUP_STATUS, { bindings: { MAIL_DB: db } });
    expect(queries.length).toBeGreaterThan(0);
  });
});

describe("GET /api/admin/system/mail-db", () => {
  let cookie: string;
  beforeEach(async () => {
    await resetApp();
    cookie = (await adminSession()).cookie;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("未登录 401", async () => {
    expect((await api(MAIL_DB_PATH)).status).toBe(401);
  });

  it("普通用户 403", async () => {
    const id = await createUser({ username: "bob" });
    const res = await api(MAIL_DB_PATH, { cookie: (await createSessionCookie(id)).cookie });
    expect(res.status).toBe(403);
  });

  it("管理员：健康库 ok", async () => {
    const res = await api(MAIL_DB_PATH, { cookie });
    expect(res.status).toBe(200);
    expect(mailDbCompatSchema.parse(await res.json())).toEqual({ status: "ok", db_version: "v0.0.11", missing_required: [] });
  });

  it("管理员：缺 to_address 为 no_icloud；缺必需列为 unhealthy", async () => {
    await setupMailDb({ omitColumns: ["to_address"] });
    expect(mailDbCompatSchema.parse(await (await api(MAIL_DB_PATH, { cookie })).json()).status).toBe("no_icloud");
    await setupMailDb({ omitColumns: ["raw"] });
    expect(mailDbCompatSchema.parse(await (await api(MAIL_DB_PATH, { cookie })).json())).toMatchObject({
      status: "unhealthy",
      missing_required: ["raw"],
    });
  });

  it("管理员：探测抛错为 probe_failed（200 + 错误码），并记日志", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await api(MAIL_DB_PATH, { cookie, bindings: { MAIL_DB: throwingMailDb("boom") } });
    expect(res.status).toBe(200);
    expect(mailDbCompatSchema.parse(await res.json())).toMatchObject({ status: "probe_failed", error_code: "query_failed" });
    expect(errorLog).toHaveBeenCalled();
  });

  it("用缓存的探测结果：健康库连续请求只探测一次", async () => {
    await api(MAIL_DB_PATH, { cookie });
    const { db, queries } = countingMailDb();
    await api(MAIL_DB_PATH, { cookie, bindings: { MAIL_DB: db } });
    expect(queries).toEqual([]);
  });
});

describe("文案口径", () => {
  it("worker 的缺 to_address 警告包含前端提示的关键信息", () => {
    for (const keyword of ["to_address", "iCloud", "Hide My Email", "db/2026-08-02-to-address.sql", "v1.15.0"]) {
      expect(WARNING_NO_TO_ADDRESS).toContain(keyword);
    }
  });
});

describe("探测缓存 TTL", () => {
  const T0 = 1_800_000_000;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0 * 1000);
    await resetApp();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("缺 to_address：TTL 内命中缓存（不再查询），过期后重探；加上列后变 ok 且查询带 to_address", async () => {
    await setupMailDb({ omitColumns: ["to_address"] });
    const first = countingMailDb();
    expect((await getMailSchema(first.db)).capabilities.to_address).toBe(false);
    const probed = first.queries.length;
    expect(probed).toBeGreaterThan(0);

    // 管理员执行迁移
    await env.MAIL_DB.prepare("ALTER TABLE raw_mails ADD COLUMN to_address TEXT").run();
    vi.setSystemTime((T0 + MAIL_SCHEMA_DEGRADED_CACHE_TTL_SEC - 1) * 1000);
    expect((await getMailSchema(first.db)).capabilities.to_address).toBe(false);
    expect(first.queries.length).toBe(probed);

    vi.setSystemTime((T0 + MAIL_SCHEMA_DEGRADED_CACHE_TTL_SEC) * 1000);
    expect((await getMailSchema(first.db)).capabilities.to_address).toBe(true);
    expect(first.queries.length).toBeGreaterThan(probed);

    // 候选查询此后带 to_address
    const queries = countingMailDb();
    await listCandidates(queries.db, { addresses: ["a@icloud.com"], limit: 5 });
    expect(queries.queries.some((q) => q.includes("to_address"))).toBe(true);
  });

  it("完全兼容的结果不过期", async () => {
    const counted = countingMailDb();
    await getMailSchema(counted.db);
    const probed = counted.queries.length;
    vi.setSystemTime((T0 + MAIL_SCHEMA_DEGRADED_CACHE_TTL_SEC * 100) * 1000);
    await getMailSchema(counted.db);
    expect(counted.queries.length).toBe(probed);
  });

  it("不健康的结果不缓存", async () => {
    await setupMailDb({ omitColumns: ["raw"] });
    const counted = countingMailDb();
    await getMailSchema(counted.db);
    const probed = counted.queries.length;
    await getMailSchema(counted.db);
    expect(counted.queries.length).toBeGreaterThan(probed);
  });
});
