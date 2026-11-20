import { env } from "cloudflare:workers";
import type { AdminOAuthProvider } from "@maillink/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OAUTH_STATE_SEC } from "../src/constants";
import { adminSession, api, auditRows, createSessionCookie, createUser, resetApp, sidSetCookie } from "./helpers";
import { FakeIdp, IDP_ISSUER } from "./fake-idp";
import { createProvider, finishCallback, linkIdentity, runOAuth } from "./oauth-helpers";
import type { ErrorBody } from "./security-helpers";
import { cookieFrom } from "./security-helpers";

const CLAIMS = { sub: "idp-user-1", email: "alice@example.com", email_verified: true, name: "Alice" };

let idp: FakeIdp;
let adminCookie: string;
let provider: AdminOAuthProvider;

beforeEach(async () => {
  await resetApp();
  idp = await FakeIdp.create();
  idp.install();
  adminCookie = (await adminSession()).cookie;
  provider = await createProvider(adminCookie);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function editable(row: AdminOAuthProvider): Record<string, unknown> {
  const { id: _id, client_secret_set: _set, callback_url: _cb, created_at: _c, updated_at: _u, ...rest } = row;
  return rest;
}

describe("必修 2：回调时重新检查 auth.login_methods", () => {
  it("发起后管理员关掉 oauth 登录：回调 provider_unavailable，不发会话", async () => {
    await linkIdentity(await createUser({ username: "alice" }), provider.id, CLAIMS.sub);
    const start = await api("/api/auth/oauth/idp/start");
    const path = idp.authorize(start.headers.get("Location") ?? "", CLAIMS);
    await env.APP_DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('auth.login_methods', '[\"password\"]', 0)").run();
    const done = await finishCallback(path, cookieFrom(start, "oauth_flow") ?? "");
    expect(done.result).toBe("provider_unavailable");
    expect(sidSetCookie(done.res)).toBeUndefined();
    expect(idp.requests.some((item) => item.url.endsWith("/token"))).toBe(false);
  });
});

describe("必修 3：OAuth 流程失败写审计", () => {
  beforeEach(async () => {
    await linkIdentity(await createUser({ username: "alice" }), provider.id, CLAIMS.sub);
  });

  it("login 模式：token_invalid / exchange_failed / profile_invalid 写 auth.login_failed", async () => {
    idp.tweaks = { aud: "someone-else" };
    expect((await runOAuth(idp, CLAIMS)).result).toBe("token_invalid");
    idp.tweaks = {};
    expect((await runOAuth(idp, CLAIMS, { challenge: "attacker-challenge" })).result).toBe("exchange_failed");
    expect((await runOAuth(idp, { email: "x@example.com", sub: "s".repeat(300) })).result).toBe("profile_invalid");
    const rows = (await auditRows("auth.login_failed")).map((row) => JSON.parse(row.detail ?? "{}"));
    expect(rows).toEqual([
      { method: "oauth:idp", reason: "token_invalid" },
      { method: "oauth:idp", reason: "exchange_failed" },
      { method: "oauth:idp", reason: "profile_invalid" },
    ]);
  });

  it("link 模式：失败写 auth.identity_link_rejected，带发起用户", async () => {
    const bob = await createUser({ username: "bob" });
    idp.tweaks = { nonce: "other" };
    const flow = await runOAuth(idp, CLAIMS, { mode: "link", cookie: (await createSessionCookie(bob)).cookie });
    expect(flow.result).toBe("token_invalid");
    const rows = await auditRows("auth.identity_link_rejected");
    expect(rows.map((row) => ({ actor: row.actor_user_id, detail: JSON.parse(row.detail ?? "{}") }))).toEqual([
      { actor: bob, detail: { method: "oauth:idp", provider: "idp", reason: "token_invalid" } },
    ]);
  });
});

describe("一并修 5：有绑定时禁止修改身份相关字段", () => {
  it("改 issuer / client_id / 端点返回 409 并写审计；改名称与 secret 照常；没有绑定时可改", async () => {
    const userId = await createUser({ username: "alice" });
    await linkIdentity(userId, provider.id, CLAIMS.sub);
    const changes: Array<Record<string, unknown>> = [
      { client_id: "another-client" },
      { token_endpoint: "https://evil.example.com/token" },
      { kind: "oauth2", issuer: null, userinfo_endpoint: `${IDP_ISSUER}/userinfo`, scopes: "x" },
    ];
    for (const change of changes) {
      const res = await api(`/api/admin/oauth-providers/${provider.id}`, { method: "PUT", json: { ...editable(provider), ...change }, cookie: adminCookie });
      expect(res.status, JSON.stringify(change)).toBe(409);
      expect(((await res.json()) as ErrorBody).error.code).toBe("oauth_provider_has_identities");
    }
    expect(await auditRows("oauth_provider.update_rejected")).toHaveLength(3);
    const rename = await api(`/api/admin/oauth-providers/${provider.id}`, {
      method: "PUT",
      json: { ...editable(provider), name: "Renamed", client_secret: "rotated" },
      cookie: adminCookie,
    });
    expect(rename.status).toBe(200);

    await env.APP_DB.prepare("DELETE FROM user_identities").run();
    const free = await api(`/api/admin/oauth-providers/${provider.id}`, { method: "PUT", json: { ...editable(provider), client_id: "another-client" }, cookie: adminCookie });
    expect(free.status).toBe(200);
  });
});

describe("一并修 7 / 8：出站地址与 id_token 细节", () => {
  it("拒绝空标签主机名与非默认端口", async () => {
    for (const issuer of ["https://localhost..", "https://idp.example.com:8443", "https://idp..example.com"]) {
      const res = await api("/api/admin/oauth-providers/discover", { json: { issuer }, cookie: adminCookie });
      expect(res.status, issuer).toBe(400);
    }
    expect(idp.requests.filter((item) => item.url.includes("..") || item.url.includes(":8443"))).toHaveLength(0);
  });

  it(`id_token 签发早于 ${OAUTH_STATE_SEC} 秒、或单受众但 azp 不是本客户端：token_invalid`, async () => {
    await linkIdentity(await createUser({ username: "alice" }), provider.id, CLAIMS.sub);
    idp.tweaks = { issuedAgo: OAUTH_STATE_SEC + 120, expiresIn: 3600 };
    expect((await runOAuth(idp, CLAIMS)).result).toBe("token_invalid");
    idp.tweaks = {};
    expect((await runOAuth(idp, { ...CLAIMS, azp: "someone-else" })).result).toBe("token_invalid");
    expect((await runOAuth(idp, { ...CLAIMS, azp: provider.client_id })).result).toBe("ok");
  });
});

describe("一并修 6：管理员改邮箱才打标记", () => {
  it("管理员提交与用户自填相同的邮箱不打标记，提交不同邮箱才打", async () => {
    const userId = await createUser({ username: "alice" });
    const cookie = (await createSessionCookie(userId)).cookie;
    await api("/api/me", { method: "PATCH", json: { email: "alice@example.com" }, cookie });
    const flag = () => env.APP_DB.prepare("SELECT email_admin_set AS f FROM users WHERE id = ?").bind(userId).first<{ f: number }>();

    expect((await api(`/api/admin/users/${userId}`, { method: "PATCH", json: { email: "Alice@Example.com" }, cookie: adminCookie })).status).toBe(200);
    expect((await flag())?.f).toBe(0);
    await api(`/api/admin/users/${userId}`, { method: "PATCH", json: { email: "alice@corp.example.com" }, cookie: adminCookie });
    expect((await flag())?.f).toBe(1);
  });
});

describe("一并修 11：全站关掉的登录方式不算可用方式", () => {
  it("关掉通行密钥后，只剩通行密钥与一个绑定的账号不能解绑", async () => {
    const userId = await createUser({ username: "alice" });
    await env.APP_DB.prepare("UPDATE users SET password_hash = NULL WHERE id = ?").bind(userId).run();
    await env.APP_DB
      .prepare("INSERT INTO user_passkeys (user_id, name, credential_id, public_key, created_at) VALUES (?, 'k', 'cred', 'pk', 0)")
      .bind(userId)
      .run();
    const identityId = await linkIdentity(userId, provider.id, CLAIMS.sub);
    const cookie = (await createSessionCookie(userId)).cookie;
    await env.APP_DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('auth.login_methods', '[\"password\",\"oauth\"]', 0)").run();

    const res = await api(`/api/me/identities/${identityId}`, { method: "DELETE", cookie });
    expect(res.status).toBe(409);
    const cleared = await api(`/api/admin/users/${userId}/identities`, { method: "DELETE", cookie: adminCookie });
    expect(((await cleared.json()) as { no_login_method: boolean }).no_login_method).toBe(true);
  });
});
