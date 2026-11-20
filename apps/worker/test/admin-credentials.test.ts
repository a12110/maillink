import { env } from "cloudflare:workers";
import type { AdminUserDetail, CredentialRemovalResponse } from "@maillink/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { adminSession, api, auditRows, createSessionCookie, createUser, login, resetApp, sessionCount } from "./helpers";
import { linkIdentity } from "./oauth-helpers";
import { enableTotp } from "./security-helpers";

async function insertProvider(slug: string): Promise<number> {
  const result = await env.APP_DB
    .prepare(
      `INSERT INTO oauth_providers (slug, name, kind, client_id, client_secret_enc, scopes, claim_map, created_at, updated_at)
       VALUES (?, ?, 'oidc', 'c', 'v1.x.y', 'openid', '{"subject":"sub","email":null,"email_verified":null,"name":null}', 0, 0)`,
    )
    .bind(slug, slug.toUpperCase())
    .run();
  return result.meta.last_row_id;
}

async function insertPasskey(userId: number, name: string): Promise<number> {
  const result = await env.APP_DB
    .prepare("INSERT INTO user_passkeys (user_id, name, credential_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, 'pk', 0, '[\"usb\"]', 0)")
    .bind(userId, name, crypto.randomUUID())
    .run();
  return result.meta.last_row_id;
}

async function remove(path: string, cookie: string): Promise<{ status: number; body: CredentialRemovalResponse }> {
  const res = await api(path, { method: "DELETE", cookie });
  return { status: res.status, body: (await res.json()) as CredentialRemovalResponse };
}

describe("管理端清除用户凭据", () => {
  let admin: { id: number; cookie: string };
  let alice: number;
  let providerId: number;

  beforeEach(async () => {
    await resetApp();
    admin = await adminSession();
    alice = await createUser({ username: "alice" });
    await enableTotp(await login("alice"));
    providerId = await insertProvider("idp");
  });

  it("详情与列表的登录方式标记来自真实数据", async () => {
    const first = await insertPasskey(alice, "钥匙一");
    await insertPasskey(alice, "钥匙二");
    const identityId = await linkIdentity(alice, providerId, "sub-1");

    const detail = (await (await api(`/api/admin/users/${alice}`, { cookie: admin.cookie })).json()) as AdminUserDetail;
    expect(detail.login_methods).toEqual({ password: true, totp: true, passkey_count: 2, oauth_providers: ["idp"] });
    expect(detail.passkeys.map((item) => item.id)).toContain(first);
    expect(detail.passkeys[0]).toMatchObject({ name: "钥匙一", transports: ["usb"] });
    expect(detail.identities).toEqual([
      { id: identityId, provider: { slug: "idp", name: "IDP", icon: null }, email: null, display_name: null, created_at: 0, last_login_at: null },
    ]);
    const list = (await (await api("/api/admin/users", { cookie: admin.cookie })).json()) as { items: AdminUserDetail[] };
    expect(list.items.find((item) => item.id === alice)?.login_methods.totp).toBe(true);
  });

  it("清除两步验证：删密钥与恢复码、该用户会话全部失效、写审计；再清一次 removed 为 0", async () => {
    expect(await sessionCount(alice)).toBe(1);
    const { status, body } = await remove(`/api/admin/users/${alice}/totp`, admin.cookie);
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok", removed: 1, sessions_revoked: 1, no_login_method: false });
    const row = await env.APP_DB.prepare("SELECT totp_secret_enc, totp_enabled_at FROM users WHERE id = ?").bind(alice).first();
    expect(row).toEqual({ totp_secret_enc: null, totp_enabled_at: null });
    expect(await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM user_recovery_codes").first()).toEqual({ n: 0 });
    expect(await auditRows("user.totp_clear")).toHaveLength(1);

    const again = await remove(`/api/admin/users/${alice}/totp`, admin.cookie);
    expect(again.body).toMatchObject({ removed: 0, sessions_revoked: 0 });
  });

  it("删除单把 / 全部通行密钥与绑定；不再有登录方式时给出 no_login_method", async () => {
    const one = await insertPasskey(alice, "一");
    await insertPasskey(alice, "二");
    const identityId = await linkIdentity(alice, providerId, "sub-1");
    await env.APP_DB.prepare("UPDATE users SET password_hash = NULL WHERE id = ?").bind(alice).run();
    const bob = await createUser({ username: "bob" });

    expect((await api(`/api/admin/users/${bob}/passkeys/${one}`, { method: "DELETE", cookie: admin.cookie })).status).toBe(404);
    expect((await remove(`/api/admin/users/${alice}/passkeys/${one}`, admin.cookie)).body).toMatchObject({ removed: 1, no_login_method: false });
    expect((await remove(`/api/admin/users/${alice}/passkeys`, admin.cookie)).body).toMatchObject({ removed: 1, no_login_method: false });
    expect((await api(`/api/admin/users/${alice}/identities/999`, { method: "DELETE", cookie: admin.cookie })).status).toBe(404);
    const last = await remove(`/api/admin/users/${alice}/identities/${identityId}`, admin.cookie);
    expect(last.body).toMatchObject({ removed: 1, no_login_method: true });
    expect((await remove(`/api/admin/users/${alice}/identities`, admin.cookie)).body).toMatchObject({ removed: 0, no_login_method: true });

    const audits = await auditRows("user.passkeys_remove");
    expect(audits.map((item) => JSON.parse(item.detail ?? "{}"))).toEqual([
      // beforeEach 里 alice 登录过一次，第一次清除时那个会话被注销
      { passkey_id: one, removed: 1, sessions_revoked: 1, no_login_method: false },
      { scope: "all", removed: 1, sessions_revoked: 0, no_login_method: false },
    ]);
    expect(await auditRows("user.identities_remove")).toHaveLength(2);
  });

  it("管理员清自己的凭据时保留当前会话；非管理员 403；用户不存在 404", async () => {
    await insertPasskey(admin.id, "管理员的钥匙");
    await createSessionCookie(admin.id);
    const own = await remove(`/api/admin/users/${admin.id}/passkeys`, admin.cookie);
    expect(own.body).toMatchObject({ removed: 1, sessions_revoked: 1 });
    expect((await api("/api/auth/session", { cookie: admin.cookie })).status).toBe(200);

    const userCookie = (await createSessionCookie(alice)).cookie;
    expect((await api(`/api/admin/users/${alice}/totp`, { method: "DELETE", cookie: userCookie })).status).toBe(403);
    expect((await api("/api/admin/users/9999/totp", { method: "DELETE", cookie: admin.cookie })).status).toBe(404);
  });
});
