import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { auditLogListSchema } from "@maillink/shared";
import { insertAuditLog } from "../src/db/audit";
import { TEST_PASSWORD, adminSession, api, createSessionCookie, createUser, resetApp } from "./helpers";

const PATH = "/api/admin/audit-logs";

type Seed = { action: string; actor?: number | null; type?: string; id?: string; at: number; detail?: object | null };

async function seed(entries: Seed[]): Promise<void> {
  for (const entry of entries) {
    await insertAuditLog(env.APP_DB, {
      actor_user_id: entry.actor ?? null,
      action: entry.action,
      target_type: entry.type ?? null,
      target_id: entry.id ?? null,
      detail: entry.detail === undefined || entry.detail === null ? null : JSON.stringify(entry.detail),
      ip: "203.0.113.1",
      created_at: entry.at,
    });
  }
}

describe("GET /api/admin/audit-logs", () => {
  let cookie: string;
  let adminId: number;

  const list = async (query = "") => {
    const res = await api(`${PATH}${query}`, { cookie });
    expect(res.status).toBe(200);
    return auditLogListSchema.parse(await res.json());
  };

  beforeEach(async () => {
    await resetApp();
    ({ id: adminId, cookie } = await adminSession());
  });

  it("需要管理员：未登录 401，普通用户 403", async () => {
    expect((await api(PATH)).status).toBe(401);
    const userCookie = (await createSessionCookie(await createUser({ username: "plain" }))).cookie;
    expect((await api(PATH, { cookie: userCookie })).status).toBe(403);
  });

  it("id 倒序、no-store、detail 解析为 JSON、带执行者用户名", async () => {
    await seed([
      { action: "user.create", actor: adminId, type: "user", id: "7", at: 100, detail: { username: "bob" } },
      { action: "auth.login_failed", at: 200, detail: { username: "ghost", reason: "unknown_user" } },
    ]);
    const res = await api(PATH, { cookie });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = auditLogListSchema.parse(await res.json());
    expect(body.next_cursor).toBeNull();
    expect(body.items.map((item) => item.action)).toEqual(["auth.login_failed", "user.create"]);
    expect(body.items[0]).toMatchObject({ actor_user_id: null, actor_username: null, detail: { reason: "unknown_user" } });
    expect(body.items[1]).toMatchObject({ actor_user_id: adminId, actor_username: "root", target_id: "7", ip: "203.0.113.1" });
  });

  it("按动作、执行者、目标类型/ID、时间范围（含边界）筛选", async () => {
    await seed([
      { action: "user.create", actor: adminId, type: "user", id: "1", at: 100 },
      { action: "user.update", actor: adminId, type: "user", id: "1", at: 200 },
      { action: "user.update", actor: 999, type: "user", id: "2", at: 300 },
      { action: "auth.session_revoke", actor: adminId, type: "session", id: "abc", at: 400 },
    ]);
    const actions = async (query: string) => (await list(query)).items.map((item) => `${item.action}@${item.created_at}`);

    expect(await actions("?action=user.update")).toEqual(["user.update@300", "user.update@200"]);
    expect(await actions("?actor_user_id=999")).toEqual(["user.update@300"]);
    expect(await actions("?target_type=session")).toEqual(["auth.session_revoke@400"]);
    expect(await actions("?target_type=user&target_id=1")).toEqual(["user.update@200", "user.create@100"]);
    expect(await actions("?since=200&until=300")).toEqual(["user.update@300", "user.update@200"]);
    expect(await actions("?since=401")).toEqual([]);
    expect(await actions(`?action=user.update&actor_user_id=${adminId}&since=0&until=250`)).toEqual(["user.update@200"]);
  });

  it("id 游标分页：不重不漏，最后一页 next_cursor 为 null", async () => {
    await seed(Array.from({ length: 5 }, (_, i) => ({ action: "user.update", at: 10 + i })));
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await list(`?limit=2${cursor === null ? "" : `&cursor=${cursor}`}`);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.next_cursor;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(seen).toEqual([...seen].sort((a, b) => b - a));
    expect(new Set(seen).size).toBe(5);
  });

  it("非法参数：400 validation_error", async () => {
    for (const query of ["?since=abc", "?limit=0", "?limit=101", "?cursor=x", "?since=10&until=5", "?actor_user_id=0", "?action="]) {
      const res = await api(`${PATH}${query}`, { cookie });
      expect(res.status, query).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("validation_error");
    }
  });

  it("真实写入方的日志不含密码与令牌", async () => {
    const created = await api("/api/admin/users", {
      cookie,
      json: { username: "carol", password: "carol-secret-pass-1" },
    });
    expect(created.status).toBe(201);
    await api("/api/auth/login", { json: { username: "carol", password: "carol-wrong-pass-2" } });
    await api("/api/auth/login", { json: { username: "carol", password: "carol-secret-pass-1" } });
    await api("/api/me/password", {
      cookie: (await createSessionCookie(await userId("carol"))).cookie,
      json: { current_password: "carol-secret-pass-1", new_password: "carol-brand-new-pass-3" },
    });
    const text = JSON.stringify(await list("?limit=100"));
    for (const secret of ["carol-secret-pass-1", "carol-wrong-pass-2", "carol-brand-new-pass-3", TEST_PASSWORD, "setup_token", "SETUP"]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain("auth.login_failed");
    expect(text).toContain("user.create");
    expect(text).toContain("auth.password_change");
  });
});

async function userId(username: string): Promise<number> {
  const row = await env.APP_DB.prepare("SELECT id FROM users WHERE username_lc = ?1").bind(username).first<{ id: number }>();
  if (!row) throw new Error(`没有用户 ${username}`);
  return row.id;
}
