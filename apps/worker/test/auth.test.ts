import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SESSION_ABSOLUTE_SEC,
  SESSION_IDLE_SEC,
  SESSION_TOUCH_INTERVAL_SEC,
} from "../src/constants";
import { sha256Hex } from "../src/auth/crypto";
import {
  TEST_PASSWORD,
  api,
  createSessionCookie,
  createUser,
  login,
  resetApp,
  sessionCount,
  sidSetCookie,
} from "./helpers";

type ErrorBody = { error: { code: string; message: string } };

const nowSec = () => Math.floor(Date.now() / 1000);

async function sessionRow(idHash: string) {
  return env.APP_DB
    .prepare("SELECT last_seen_at, expires_at FROM sessions WHERE id_hash = ?")
    .bind(idHash)
    .first<{ last_seen_at: number; expires_at: number }>();
}

describe("登录", () => {
  beforeEach(resetApp);

  it("成功：返回 ok，Cookie 属性正确，库里只存 SHA-256", async () => {
    const userId = await createUser({ username: "Alice" });
    const res = await api("/api/auth/login", { json: { username: "Alice", password: TEST_PASSWORD } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });

    const line = sidSetCookie(res) ?? "";
    const token = /^sid=([^;]+)/.exec(line)?.[1] ?? "";
    // 32 字节 base64url = 43 个字符，且没有 + / =
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(line).toContain("HttpOnly");
    expect(line).toContain("Secure");
    expect(line).toMatch(/SameSite=Lax/i);
    expect(line).toContain("Path=/");
    expect(line).toContain(`Max-Age=${SESSION_ABSOLUTE_SEC}`);

    const stored = await env.APP_DB
      .prepare("SELECT id_hash, user_id, auth_methods, expires_at, created_at FROM sessions")
      .all<{ id_hash: string; user_id: number; auth_methods: string; expires_at: number; created_at: number }>();
    expect(stored.results).toHaveLength(1);
    const row = stored.results[0];
    expect(row).toMatchObject({ id_hash: await sha256Hex(token), user_id: userId, auth_methods: "password" });
    expect(row?.id_hash).not.toBe(token);
    expect(row).toMatchObject({ expires_at: (row?.created_at ?? 0) + SESSION_ABSOLUTE_SEC });

    const user = await env.APP_DB
      .prepare("SELECT last_login_at FROM users WHERE id = ?")
      .bind(userId)
      .first<{ last_login_at: number | null }>();
    expect(user?.last_login_at).not.toBeNull();
  });

  it("用户名大小写不敏感", async () => {
    await createUser({ username: "Alice" });
    expect((await api("/api/auth/login", { json: { username: "aLiCe", password: TEST_PASSWORD } })).status).toBe(200);
  });

  it("密码错误、用户不存在、账号被禁用：响应完全一致，且不发 Cookie", async () => {
    await createUser({ username: "alice" });
    await createUser({ username: "frozen", status: "disabled" });
    const attempts = [
      { username: "alice", password: "wrong-password" },
      { username: "nobody", password: TEST_PASSWORD },
      { username: "frozen", password: TEST_PASSWORD },
    ];
    const bodies: string[] = [];
    for (const attempt of attempts) {
      const res = await api("/api/auth/login", { json: attempt });
      expect(res.status).toBe(401);
      expect(sidSetCookie(res)).toBeUndefined();
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    const parsed = JSON.parse(bodies[0] ?? "") as ErrorBody;
    expect(parsed.error).toEqual({ code: "invalid_credentials", message: "用户名或密码错误" });
    expect(await sessionCount()).toBe(0);
  });

  it("没有设密码的用户无法登录，同样返回统一错误", async () => {
    await env.APP_DB
      .prepare("INSERT INTO users (username, username_lc, role, created_at, updated_at) VALUES ('nopw', 'nopw', 'user', 1, 1)")
      .run();
    const res = await api("/api/auth/login", { json: { username: "nopw", password: TEST_PASSWORD } });
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorBody).error.code).toBe("invalid_credentials");
  });

  it("请求体缺字段：400", async () => {
    const res = await api("/api/auth/login", { json: { username: "alice" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe("validation_error");
  });

  it("请求体不是 JSON：400 invalid_json", async () => {
    const res = await api("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe("invalid_json");
  });

  it("携带旧会话 Cookie 再次登录：旧会话被删除，不留僵尸会话", async () => {
    await createUser({ username: "alice" });
    const first = await login("alice");
    const res = await api("/api/auth/login", { json: { username: "alice", password: TEST_PASSWORD }, cookie: first });
    expect(res.status).toBe(200);
    expect(await sessionCount()).toBe(1);
    expect((await api("/api/auth/session", { cookie: first })).status).toBe(401);
  });
});

describe("会话", () => {
  beforeEach(resetApp);

  it("GET /api/auth/session：返回用户与角色；无 Cookie 为 401", async () => {
    await createUser({ username: "alice", role: "admin" });
    const cookie = await login("alice");
    const res = await api("/api/auth/session", { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: Record<string, unknown>; auth_methods: string[]; expires_at: number };
    expect(body.user).toMatchObject({ username: "alice", role: "admin", display_name: null, email: null });
    expect(body.user).not.toHaveProperty("status");
    expect(body.auth_methods).toEqual(["password"]);

    const anonymous = await api("/api/auth/session");
    expect(anonymous.status).toBe(401);
    expect(((await anonymous.json()) as ErrorBody).error.code).toBe("unauthenticated");
  });

  it("伪造或不存在的 sid：401", async () => {
    const res = await api("/api/auth/session", { cookie: "sid=not-a-real-session" });
    expect(res.status).toBe(401);
  });

  it("空闲超时：last_seen_at 超过空闲期 → 401，且会话行被清理", async () => {
    const id = await createUser({ username: "alice" });
    const now = nowSec();
    const { cookie, idHash } = await createSessionCookie(id, {
      created_at: now - SESSION_IDLE_SEC - 100,
      last_seen_at: now - SESSION_IDLE_SEC - 1,
      expires_at: now + 1000,
    });
    expect((await api("/api/auth/session", { cookie })).status).toBe(401);
    expect(await sessionRow(idHash)).toBeNull();
  });

  it("空闲期内仍有效", async () => {
    const id = await createUser({ username: "alice" });
    const now = nowSec();
    const { cookie } = await createSessionCookie(id, {
      created_at: now - SESSION_IDLE_SEC,
      last_seen_at: now - SESSION_IDLE_SEC + 60,
      expires_at: now + 1000,
    });
    expect((await api("/api/auth/session", { cookie })).status).toBe(200);
  });

  it("绝对超时：即使刚刚活跃，过了 expires_at 也是 401", async () => {
    const id = await createUser({ username: "alice" });
    const now = nowSec();
    const { cookie, idHash } = await createSessionCookie(id, {
      created_at: now - SESSION_ABSOLUTE_SEC - 10,
      last_seen_at: now - 5,
      expires_at: now - 1,
    });
    expect((await api("/api/auth/session", { cookie })).status).toBe(401);
    expect(await sessionRow(idHash)).toBeNull();
  });

  it("账号被禁用后，已有会话立即 401", async () => {
    const id = await createUser({ username: "alice" });
    const { cookie } = await createSessionCookie(id);
    expect((await api("/api/auth/session", { cookie })).status).toBe(200);
    await env.APP_DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind(id).run();
    expect((await api("/api/auth/session", { cookie })).status).toBe(401);
  });

  it("last_seen_at 节流：阈值内不写库，超过阈值才刷新", async () => {
    const id = await createUser({ username: "alice" });
    const now = nowSec();
    const recent = await createSessionCookie(id, { last_seen_at: now - 10 });
    await api("/api/auth/session", { cookie: recent.cookie });
    expect((await sessionRow(recent.idHash))?.last_seen_at).toBe(now - 10);

    const stale = await createSessionCookie(id, { last_seen_at: now - SESSION_TOUCH_INTERVAL_SEC - 10 });
    await api("/api/auth/session", { cookie: stale.cookie });
    expect((await sessionRow(stale.idHash))?.last_seen_at).toBeGreaterThanOrEqual(now);
  });

  it("注销：删除会话行、清 Cookie，之后该 Cookie 401", async () => {
    await createUser({ username: "alice" });
    const cookie = await login("alice");
    const res = await api("/api/auth/logout", { method: "POST", cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    const line = sidSetCookie(res) ?? "";
    expect(line).toMatch(/Max-Age=0|Expires=/);
    expect(await sessionCount()).toBe(0);
    expect((await api("/api/auth/session", { cookie })).status).toBe(401);
  });

  it("没有会话时注销也成功（幂等）", async () => {
    const res = await api("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("注销只影响当前会话", async () => {
    const id = await createUser({ username: "alice" });
    const mine = await login("alice");
    const other = await createSessionCookie(id);
    await api("/api/auth/logout", { method: "POST", cookie: mine });
    expect((await api("/api/auth/session", { cookie: other.cookie })).status).toBe(200);
  });
});
