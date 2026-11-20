import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { builtinRuleGroupTemplates } from "@maillink/shared";
import { verifyPassword } from "../src/auth/password";
import { compileRuleGroup } from "../src/rules";
import { api, createUser, resetApp } from "./helpers";

const VALID = { username: "Admin", password: "a-long-enough-password", setup_token: "test-setup-token" };

type ErrorBody = { error: { code: string; message: string } };

async function userRows() {
  const { results } = await env.APP_DB
    .prepare("SELECT id, username, username_lc, role, status, password_hash FROM users")
    .all<{ id: number; username: string; username_lc: string; role: string; status: string; password_hash: string }>();
  return results;
}

describe("首次初始化", () => {
  beforeEach(resetApp);

  it("GET /api/setup/status：没有用户时需要初始化", async () => {
    const res = await api("/api/setup/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      needs_setup: true,
      mail_db: { status: "ok", db_version: "v0.0.11", missing_required: [] },
    });
  });

  it("缺 setup_token：400 校验错误，不创建用户", async () => {
    const { setup_token: _omit, ...withoutToken } = VALID;
    const res = await api("/api/setup", { json: withoutToken });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe("validation_error");
    expect(await userRows()).toEqual([]);
  });

  it("错误的 setup_token：403，不创建用户", async () => {
    const res = await api("/api/setup", { json: { ...VALID, setup_token: "wrong-token" } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe("invalid_setup_token");
    expect(await userRows()).toEqual([]);
  });

  it("服务端没配 SETUP_TOKEN：503 明确报错，不放行", async () => {
    const res = await api("/api/setup", { json: VALID, bindings: { SETUP_TOKEN: undefined } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as ErrorBody).error.code).toBe("setup_token_not_configured");
    expect(await userRows()).toEqual([]);
  });

  it("用户名或密码不合规：400", async () => {
    const shortPassword = await api("/api/setup", { json: { ...VALID, password: "short" } });
    expect(shortPassword.status).toBe(400);
    const badUsername = await api("/api/setup", { json: { ...VALID, username: "has space" } });
    expect(badUsername.status).toBe(400);
    expect(await userRows()).toEqual([]);
  });

  it("成功：创建启用状态的管理员，密码以哈希存储，写审计", async () => {
    const res = await api("/api/setup", { json: VALID });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ status: "ok" });

    const rows = await userRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ username: "Admin", username_lc: "admin", role: "admin", status: "active" });
    expect(rows[0]?.password_hash).toMatch(/^pbkdf2-sha256\$/);
    expect(rows[0]?.password_hash).not.toContain(VALID.password);
    expect(await verifyPassword(env, VALID.password, rows[0]?.password_hash ?? "")).toBe(true);

    const audit = await env.APP_DB.prepare("SELECT action FROM audit_logs").all<{ action: string }>();
    expect(audit.results.map((row) => row.action)).toEqual(["setup.complete"]);

    expect(await (await api("/api/setup/status")).json()).toEqual({ needs_setup: false });
  });

  it("同一个 batch 写入 7 个内置规则组模板，全部可编译，created_by 为新管理员", async () => {
    expect((await api("/api/setup", { json: VALID })).status).toBe(201);
    const admin = (await userRows())[0];
    const { results } = await env.APP_DB.prepare("SELECT name, revision, config, created_by FROM rule_groups ORDER BY id").all<{
      name: string;
      revision: number;
      config: string;
      created_by: number;
    }>();
    expect(results.map((row) => row.name)).toEqual(builtinRuleGroupTemplates().map((template) => template.name));
    expect(results).toHaveLength(7);
    expect(results[6]?.name).toBe("指定发件人（完整显示）");
    for (const row of results) {
      expect(row.revision).toBe(1);
      expect(row.created_by).toBe(admin?.id);
      expect(compileRuleGroup(JSON.parse(row.config)).ok, row.name).toBe(true);
    }
  });

  it("并发初始化输掉的一方不会重复写模板", async () => {
    await Promise.all(["first", "second"].map((username) => api("/api/setup", { json: { ...VALID, username } })));
    const count = await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM rule_groups").first<{ n: number }>();
    expect(count?.n).toBe(7);
  });

  it("库里已有用户时 setup 不写任何模板", async () => {
    await createUser({ username: "someone" });
    expect((await api("/api/setup", { json: VALID })).status).toBe(404);
    const count = await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM rule_groups").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("已初始化后：POST /api/setup 永久 404（即使令牌正确），不新增用户", async () => {
    expect((await api("/api/setup", { json: VALID })).status).toBe(201);
    const again = await api("/api/setup", { json: { ...VALID, username: "second" } });
    expect(again.status).toBe(404);
    expect(((await again.json()) as ErrorBody).error.code).toBe("not_found");
    expect(await userRows()).toHaveLength(1);
  });

  it("库里已有用户（非通过 setup 创建）时同样 404", async () => {
    await createUser({ username: "someone" });
    expect((await api("/api/setup", { json: VALID })).status).toBe(404);
    expect(await (await api("/api/setup/status")).json()).toEqual({ needs_setup: false });
  });

  it("并发初始化：只有一个成功，其余 404", async () => {
    const results = await Promise.all(
      ["first", "second", "third"].map((username) => api("/api/setup", { json: { ...VALID, username } })),
    );
    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([201, 404, 404]);
    expect(await userRows()).toHaveLength(1);
  });
});
