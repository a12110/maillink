import { env } from "cloudflare:workers";
import type { MyIdentity } from "@maillink/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminSession, api, auditRows, createSessionCookie, createUser, resetApp, sidSetCookie } from "./helpers";
import { CLIENT_SECRET, FakeIdp, IDP_ISSUER } from "./fake-idp";
import { createProvider, identityCount, linkIdentity, runOAuth } from "./oauth-helpers";
import type { ErrorBody } from "./security-helpers";

const EMAIL = "alice@example.com";
const CLAIMS = { sub: "idp-user-1", email: EMAIL, email_verified: true, name: "Alice" };

let idp: FakeIdp;
let adminCookie: string;
let providerId: number;

/** 管理员通过管理端建一个带邮箱的用户（email_admin_set = 1） */
async function adminCreatedUser(username: string, role: "user" | "admin" = "user"): Promise<number> {
  const res = await api("/api/admin/users", {
    json: { username, password: "long-enough-password", email: EMAIL, role },
    cookie: adminCookie,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

beforeEach(async () => {
  await resetApp();
  idp = await FakeIdp.create();
  idp.install();
  adminCookie = (await adminSession()).cookie;
  providerId = (await createProvider(adminCookie, { auto_link_verified_email: true })).id;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("OAuth 自动按邮箱关联", () => {
  it("管理员设置的邮箱 + IdP email_verified 为 true：自动绑定并登录，写审计", async () => {
    const userId = await adminCreatedUser("alice");
    const flow = await runOAuth(idp, CLAIMS);
    expect(flow.result).toBe("ok");
    expect(await identityCount(userId)).toBe(1);
    const audit = await auditRows("auth.identity_link");
    expect(JSON.parse(audit[0]?.detail ?? "{}")).toMatchObject({ user_id: userId, auto: true });
  });

  it("email_verified 不是布尔 true（字符串 \"true\"、false、缺失）：不关联", async () => {
    await adminCreatedUser("alice");
    for (const verified of ["true", false, undefined]) {
      const flow = await runOAuth(idp, { ...CLAIMS, email_verified: verified });
      expect(flow.result, String(verified)).toBe("not_linked");
    }
    expect(await identityCount()).toBe(0);
  });

  it("用户自己设置的邮箱不参与关联；用户改过管理员设置的邮箱后也不再关联", async () => {
    const own = await createUser({ username: "alice" });
    const cookie = (await createSessionCookie(own)).cookie;
    await api("/api/me", { method: "PATCH", json: { email: EMAIL }, cookie });
    expect((await runOAuth(idp, CLAIMS)).result).toBe("not_linked");

    await env.APP_DB.prepare("DELETE FROM users WHERE id = ?").bind(own).run();
    const managed = await adminCreatedUser("bob");
    const bobCookie = (await createSessionCookie(managed)).cookie;
    // 提交相同邮箱不算修改，标记保留
    await api("/api/me", { method: "PATCH", json: { email: EMAIL.toUpperCase() }, cookie: bobCookie });
    const flag = await env.APP_DB.prepare("SELECT email_admin_set FROM users WHERE id = ?").bind(managed).first();
    expect(flag).toEqual({ email_admin_set: 1 });
    await api("/api/me", { method: "PATCH", json: { email: "bob@example.com" }, cookie: bobCookie });
    await api("/api/me", { method: "PATCH", json: { email: EMAIL }, cookie: bobCookie });
    expect((await runOAuth(idp, CLAIMS)).result).toBe("not_linked");
  });

  it("管理员账号、禁用账号、已绑定过该提供方的账号都不自动关联；提供方未开启时也不关联", async () => {
    const adminId = await adminCreatedUser("boss", "admin");
    expect((await runOAuth(idp, CLAIMS)).result).toBe("not_linked");
    await env.APP_DB.prepare("DELETE FROM users WHERE id = ?").bind(adminId).run();

    const userId = await adminCreatedUser("alice");
    await linkIdentity(userId, providerId, "another-subject");
    expect((await runOAuth(idp, CLAIMS)).result).toBe("not_linked");

    await env.APP_DB.prepare("DELETE FROM user_identities").run();
    await env.APP_DB.prepare("UPDATE oauth_providers SET auto_link_verified_email = 0").run();
    expect((await runOAuth(idp, CLAIMS)).result).toBe("not_linked");
    await env.APP_DB.prepare("UPDATE oauth_providers SET auto_link_verified_email = 1").run();
    await env.APP_DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind(userId).run();
    expect((await runOAuth(idp, CLAIMS)).result).toBe("not_linked");
  });
});

describe("纯 OAuth2 提供方（userinfo）", () => {
  it("用 access token 调 userinfo，数字 id 作为 subject，client_secret_post", async () => {
    idp.clientAuth = "post";
    const provider = await createProvider(adminCookie, {
      slug: "gh",
      kind: "oauth2",
      issuer: null,
      authorization_endpoint: `${IDP_ISSUER}/authorize`,
      token_endpoint: `${IDP_ISSUER}/token`,
      userinfo_endpoint: `${IDP_ISSUER}/userinfo`,
      scopes: "read:user",
      claim_map: { subject: "id", email: "email", email_verified: null, name: "login" },
    });
    const userId = await createUser({ username: "octo" });
    await linkIdentity(userId, provider.id, "4242");

    const flow = await runOAuth(idp, { id: 4242, login: "octocat", email: "o@example.com" }, { slug: "gh" });
    expect(flow.result).toBe("ok");
    expect(flow.authorizeUrl.searchParams.get("nonce")).toBeNull();
    const token = idp.requests.find((item) => item.url.endsWith("/token"));
    expect(new URLSearchParams(token?.body).get("client_secret")).toBe(CLIENT_SECRET);
    expect(sidSetCookie(flow.res)).toBeDefined();
    const identity = await env.APP_DB.prepare("SELECT email, display_name FROM user_identities WHERE user_id = ?").bind(userId).first();
    expect(identity).toEqual({ email: "o@example.com", display_name: "octocat" });
  });
});

describe("/api/me/identities", () => {
  it("列表只含 slug、名称、图标；解绑需保留至少一种登录方式", async () => {
    const userId = await createUser({ username: "alice" });
    const cookie = (await createSessionCookie(userId)).cookie;
    const identityId = await linkIdentity(userId, providerId, "s-1");

    const list = (await (await api("/api/me/identities", { cookie })).json()) as { items: MyIdentity[] };
    expect(list.items).toEqual([
      { id: identityId, provider: { slug: "idp", name: "Test IdP", icon: null }, email: null, display_name: null, created_at: 0, last_login_at: null },
    ]);

    await env.APP_DB.prepare("UPDATE users SET password_hash = NULL WHERE id = ?").bind(userId).run();
    const blocked = await api(`/api/me/identities/${identityId}`, { method: "DELETE", cookie });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as ErrorBody).error.code).toBe("last_login_method");

    // 另一个已启用提供方的绑定也算登录方式；停用的提供方不算
    const other = await createProvider(adminCookie, { slug: "other" });
    await linkIdentity(userId, other.id, "s-2");
    await env.APP_DB.prepare("UPDATE oauth_providers SET enabled = 0 WHERE id = ?").bind(other.id).run();
    expect((await api(`/api/me/identities/${identityId}`, { method: "DELETE", cookie })).status).toBe(409);
    await env.APP_DB.prepare("UPDATE oauth_providers SET enabled = 1 WHERE id = ?").bind(other.id).run();
    expect((await api(`/api/me/identities/${identityId}`, { method: "DELETE", cookie })).status).toBe(200);
    expect(await auditRows("auth.identity_unlink")).toHaveLength(1);
    expect((await api(`/api/me/identities/${identityId}`, { method: "DELETE", cookie })).status).toBe(404);
  });
});
