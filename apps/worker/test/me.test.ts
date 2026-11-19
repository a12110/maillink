import { env } from "cloudflare:workers";
import type { MeResponse, MySession } from "@maillink/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_PASSWORD, api, auditRows, createSessionCookie, createUser, login, resetApp, sessionCount } from "./helpers";

type ErrorBody = { error: { code: string; message: string } };

const NEW_PASSWORD = "brand-new-password-1";

describe("/api/me", () => {
  beforeEach(resetApp);

  it("未登录：401", async () => {
    for (const path of ["/api/me", "/api/me/sessions"]) {
      expect((await api(path)).status, path).toBe(401);
    }
    expect((await api("/api/me", { method: "PATCH", json: { display_name: "x" } })).status).toBe(401);
    expect((await api("/api/me/password", { json: { current_password: "a", new_password: NEW_PASSWORD } })).status).toBe(401);
  });

  it("GET：返回自己的资料，不含密码哈希", async () => {
    await createUser({ username: "alice", email: "alice@example.com" });
    const cookie = await login("alice");
    const res = await api("/api/me", { cookie });
    expect(res.status).toBe(200);
    const me = (await res.json()) as MeResponse;
    expect(me).toMatchObject({ username: "alice", email: "alice@example.com", role: "user", has_password: true });
    expect(JSON.stringify(me)).not.toContain("pbkdf2");
    expect(me.last_login_at).not.toBeNull();
  });

  it("PATCH：改显示名与邮箱，空串清空；邮箱被占用 409；空请求 400；角色等字段被忽略", async () => {
    await createUser({ username: "alice" });
    await createUser({ username: "bob", email: "bob@example.com" });
    const cookie = await login("alice");

    const res = await api("/api/me", { method: "PATCH", json: { display_name: "Alice A", email: "Alice@Example.com" }, cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ display_name: "Alice A", email: "alice@example.com" });

    const cleared = await api("/api/me", { method: "PATCH", json: { display_name: "" }, cookie });
    expect(((await cleared.json()) as MeResponse).display_name).toBeNull();

    const clash = await api("/api/me", { method: "PATCH", json: { email: "BOB@example.com" }, cookie });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as ErrorBody).error.code).toBe("email_taken");

    expect((await api("/api/me", { method: "PATCH", json: {}, cookie })).status).toBe(400);

    const sneaky = await api("/api/me", { method: "PATCH", json: { display_name: "x", role: "admin" }, cookie });
    expect(sneaky.status).toBe(200);
    expect(((await sneaky.json()) as MeResponse).role).toBe("user");
  });
});

describe("POST /api/me/password", () => {
  beforeEach(resetApp);

  it("旧密码错误：400，密码与会话都不变", async () => {
    const id = await createUser({ username: "alice" });
    const cookie = await login("alice");
    const res = await api("/api/me/password", { json: { current_password: "wrong-password", new_password: NEW_PASSWORD }, cookie });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe("invalid_current_password");
    expect(await sessionCount(id)).toBe(1);
    expect((await api("/api/auth/login", { json: { username: "alice", password: TEST_PASSWORD } })).status).toBe(200);
  });

  it("新密码不合规：400", async () => {
    await createUser({ username: "alice" });
    const cookie = await login("alice");
    const res = await api("/api/me/password", { json: { current_password: TEST_PASSWORD, new_password: "short" }, cookie });
    expect(res.status).toBe(400);
  });

  it("成功：新密码生效，旧密码失效；其他会话被注销，当前会话保留", async () => {
    const id = await createUser({ username: "alice" });
    const other = await createSessionCookie(id);
    const another = await createSessionCookie(id);
    const cookie = await login("alice");
    expect(await sessionCount(id)).toBe(3);

    const res = await api("/api/me/password", { json: { current_password: TEST_PASSWORD, new_password: NEW_PASSWORD }, cookie });
    expect(res.status).toBe(200);

    expect(await sessionCount(id)).toBe(1);
    expect((await api("/api/auth/session", { cookie })).status).toBe(200);
    expect((await api("/api/auth/session", { cookie: other.cookie })).status).toBe(401);
    expect((await api("/api/auth/session", { cookie: another.cookie })).status).toBe(401);

    expect((await api("/api/auth/login", { json: { username: "alice", password: TEST_PASSWORD } })).status).toBe(401);
    expect((await api("/api/auth/login", { json: { username: "alice", password: NEW_PASSWORD } })).status).toBe(200);

    const audit = await auditRows("auth.password_change");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor_user_id).toBe(id);
    expect(JSON.stringify(audit)).not.toContain(NEW_PASSWORD);
    expect(JSON.stringify(audit)).not.toContain(TEST_PASSWORD);
  });
});

describe("/api/me/sessions", () => {
  beforeEach(resetApp);

  it("列表：标出当前会话；对外 id 不是库里的 id_hash，也不含它", async () => {
    const id = await createUser({ username: "alice" });
    const other = await createSessionCookie(id);
    const cookie = await login("alice");

    const res = await api("/api/me/sessions", { cookie });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: MySession[] };
    expect(items).toHaveLength(2);
    expect(items.filter((item) => item.current)).toHaveLength(1);

    const hashes = (await env.APP_DB.prepare("SELECT id_hash FROM sessions").all<{ id_hash: string }>()).results.map((row) => row.id_hash);
    const serialized = JSON.stringify(items);
    for (const hash of hashes) {
      expect(serialized).not.toContain(hash);
      expect(items.map((item) => item.id)).not.toContain(hash);
    }
    expect(serialized).not.toContain(other.idHash);
    expect(items.every((item) => /^[A-Za-z0-9_-]{22}$/.test(item.id))).toBe(true);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
    expect(items.find((item) => !item.current)?.user_agent).toBe("vitest");
  });

  it("短 id 稳定：两次列表得到同一个 id", async () => {
    await createUser({ username: "alice" });
    const cookie = await login("alice");
    const read = async () => ((await (await api("/api/me/sessions", { cookie })).json()) as { items: MySession[] }).items[0]?.id;
    expect(await read()).toBe(await read());
  });

  it("注销其他会话：成功后该会话 401；注销当前会话被拒绝；未知 id 404", async () => {
    const id = await createUser({ username: "alice" });
    const other = await createSessionCookie(id);
    const cookie = await login("alice");
    const { items } = (await (await api("/api/me/sessions", { cookie })).json()) as { items: MySession[] };
    const current = items.find((item) => item.current);
    const target = items.find((item) => !item.current);

    const refuse = await api(`/api/me/sessions/${current?.id}`, { method: "DELETE", cookie });
    expect(refuse.status).toBe(400);
    expect(((await refuse.json()) as ErrorBody).error.code).toBe("cannot_revoke_current_session");

    expect((await api("/api/me/sessions/does-not-exist", { method: "DELETE", cookie })).status).toBe(404);

    const ok = await api(`/api/me/sessions/${target?.id}`, { method: "DELETE", cookie });
    expect(ok.status).toBe(200);
    expect((await api("/api/auth/session", { cookie: other.cookie })).status).toBe(401);
    expect((await api("/api/auth/session", { cookie })).status).toBe(200);
  });

  it("不能注销别人的会话：用别人的短 id 得到 404，对方会话不受影响", async () => {
    const aliceId = await createUser({ username: "alice" });
    const bobId = await createUser({ username: "bob" });
    const bobSession = await createSessionCookie(bobId);
    const aliceCookie = (await createSessionCookie(aliceId)).cookie;

    const { items } = (await (await api("/api/me/sessions", { cookie: bobSession.cookie })).json()) as { items: MySession[] };
    const bobPublicId = items[0]?.id;
    const res = await api(`/api/me/sessions/${bobPublicId}`, { method: "DELETE", cookie: aliceCookie });
    expect(res.status).toBe(404);
    expect(await sessionCount(bobId)).toBe(1);
  });
});
