import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_PASSWORD, adminSession, api, auditRows, createSessionCookie, createUser, resetApp } from "./helpers";

const NEW_PASSWORD = "audited-new-password";

function detailOf(row: { detail: string | null } | undefined): Record<string, unknown> {
  return JSON.parse(row?.detail ?? "{}") as Record<string, unknown>;
}

describe("审计日志", () => {
  beforeEach(resetApp);

  it("登录成功与失败：失败记录原因但不含密码，actor 为空；成功记录 actor 与 IP", async () => {
    const id = await createUser({ username: "alice" });
    await createUser({ username: "frozen", status: "disabled" });

    await api("/api/auth/login", { json: { username: "alice", password: "wrong-password-xyz" } });
    await api("/api/auth/login", { json: { username: "ghost", password: "wrong-password-xyz" } });
    await api("/api/auth/login", { json: { username: "frozen", password: TEST_PASSWORD } });
    await api("/api/auth/login", {
      json: { username: "alice", password: TEST_PASSWORD },
      headers: { "CF-Connecting-IP": "203.0.113.7" },
    });

    const failed = await auditRows("auth.login_failed");
    expect(failed.map((row) => detailOf(row).reason)).toEqual(["bad_password", "unknown_user", "disabled"]);
    expect(failed.map((row) => detailOf(row).username)).toEqual(["alice", "ghost", "frozen"]);
    expect(failed.every((row) => row.actor_user_id === null)).toBe(true);
    expect(failed[0]).toMatchObject({ target_type: "user", target_id: String(id) });
    expect(failed[1]).toMatchObject({ target_type: null, target_id: null });
    expect(JSON.stringify(failed)).not.toContain("wrong-password-xyz");
    expect(JSON.stringify(failed)).not.toContain(TEST_PASSWORD);

    const success = await auditRows("auth.login");
    expect(success).toHaveLength(1);
    expect(success[0]).toMatchObject({ actor_user_id: id, target_type: "user", target_id: String(id) });
    const ip = await env.APP_DB.prepare("SELECT ip FROM audit_logs WHERE action = 'auth.login'").first<{ ip: string | null }>();
    expect(ip?.ip).toBe("203.0.113.7");
  });

  it("用户管理操作：创建、修改（含 from→to）、重置密码、强制下线、删除", async () => {
    const admin = await adminSession("root");
    const created = await api("/api/admin/users", {
      json: { username: "bob", password: NEW_PASSWORD, role: "user" },
      cookie: admin.cookie,
    });
    const bobId = ((await created.json()) as { id: number }).id;
    await createSessionCookie(bobId);

    await api(`/api/admin/users/${bobId}`, { method: "PATCH", json: { role: "admin", display_name: "Bob" }, cookie: admin.cookie });
    await api(`/api/admin/users/${bobId}/password`, { json: { password: NEW_PASSWORD }, cookie: admin.cookie });
    await createSessionCookie(bobId);
    await api(`/api/admin/users/${bobId}/sessions`, { method: "DELETE", cookie: admin.cookie });
    await api(`/api/admin/users/${bobId}`, { method: "DELETE", cookie: admin.cookie });

    const rows = await auditRows();
    expect(rows.map((row) => row.action)).toEqual([
      "user.create",
      "user.update",
      "user.password_reset",
      "user.sessions_revoke",
      "user.delete",
    ]);
    expect(rows.every((row) => row.actor_user_id === admin.id)).toBe(true);
    expect(rows.every((row) => row.target_type === "user" && row.target_id === String(bobId))).toBe(true);

    expect(detailOf(rows[0])).toEqual({ username: "bob", role: "user", status: "active" });
    expect(detailOf(rows[1])).toEqual({
      changes: { role: { from: "user", to: "admin" }, display_name: { from: null, to: "Bob" } },
      sessions_revoked: 1,
    });
    expect(detailOf(rows[2])).toEqual({ sessions_revoked: 0 });
    expect(detailOf(rows[3])).toEqual({ sessions_revoked: 1 });
    expect(detailOf(rows[4])).toEqual({ username: "bob", role: "admin", status: "active" });
    expect(JSON.stringify(rows)).not.toContain(NEW_PASSWORD);
  });

  it("被拒绝的操作（最后一个管理员保护）不写审计", async () => {
    const admin = await adminSession("root");
    await api(`/api/admin/users/${admin.id}`, { method: "DELETE", cookie: admin.cookie });
    expect(await auditRows("user.delete")).toEqual([]);
  });

  it("注销自己的其他会话写审计", async () => {
    const id = await createUser({ username: "alice" });
    const mine = await createSessionCookie(id);
    await createSessionCookie(id);
    const { items } = (await (await api("/api/me/sessions", { cookie: mine.cookie })).json()) as {
      items: Array<{ id: string; current: boolean }>;
    };
    const target = items.find((item) => !item.current);
    await api(`/api/me/sessions/${target?.id}`, { method: "DELETE", cookie: mine.cookie });
    const rows = await auditRows("auth.session_revoke");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: id, target_type: "session", target_id: target?.id });
  });
});
