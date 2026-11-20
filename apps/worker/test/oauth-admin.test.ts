import { env } from "cloudflare:workers";
import type { OAuthProviderChangeResponse, PublicConfig } from "@maillink/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OAUTH_FETCH_MAX_BYTES } from "../src/constants";
import { adminSession, api, auditRows, createSessionCookie, createUser, resetApp } from "./helpers";
import { CLIENT_SECRET, FakeIdp, IDP_ISSUER } from "./fake-idp";
import { createProvider, identityCount, linkIdentity } from "./oauth-helpers";
import type { ErrorBody } from "./security-helpers";

let idp: FakeIdp;
let adminCookie: string;

async function discover(issuer: string): Promise<Response> {
  return api("/api/admin/oauth-providers/discover", { json: { issuer }, cookie: adminCookie });
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as ErrorBody).error.code;
}

beforeEach(async () => {
  await resetApp();
  idp = await FakeIdp.create();
  idp.install();
  adminCookie = (await adminSession()).cookie;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("提供方管理", () => {
  it("oidc 只填 issuer：服务端读发现文档补齐端点；secret 加密存储且从不回显；写审计", async () => {
    const provider = await createProvider(adminCookie);
    expect(provider).toMatchObject({
      slug: "idp",
      kind: "oidc",
      authorization_endpoint: `${IDP_ISSUER}/authorize`,
      token_endpoint: `${IDP_ISSUER}/token`,
      userinfo_endpoint: `${IDP_ISSUER}/userinfo`,
      jwks_uri: `${IDP_ISSUER}/jwks`,
      scopes: "openid profile email",
      client_secret_set: true,
      callback_url: `${new URL(env.PUBLIC_ORIGIN).origin}/api/auth/oauth/idp/callback`,
      claim_map: { subject: "sub", email: "email", email_verified: "email_verified", name: "name" },
    });
    expect(JSON.stringify(provider)).not.toContain(CLIENT_SECRET);
    const list = await (await api("/api/admin/oauth-providers", { cookie: adminCookie })).text();
    expect(list).not.toContain(CLIENT_SECRET);
    const stored = await env.APP_DB.prepare("SELECT client_secret_enc FROM oauth_providers").first<{ client_secret_enc: string }>();
    expect(stored?.client_secret_enc).toMatch(/^v1\./);
    expect(stored?.client_secret_enc).not.toContain(CLIENT_SECRET);
    const audit = await auditRows("oauth_provider.create");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.detail).not.toContain(CLIENT_SECRET);
  });

  it("slug 唯一（409）；oauth2 缺端点或 scopes 400；oidc scopes 缺 openid 400；端点为内网地址 400", async () => {
    await createProvider(adminCookie);
    const dup = await api("/api/admin/oauth-providers", {
      json: { slug: "idp", name: "x", kind: "oidc", issuer: IDP_ISSUER, client_id: "a", client_secret: "b" },
      cookie: adminCookie,
    });
    expect(dup.status).toBe(409);
    expect(await errorCode(dup)).toBe("oauth_slug_taken");

    const base = { name: "x", client_id: "a", client_secret: "b" };
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ slug: "gh", kind: "oauth2", authorization_endpoint: "https://gh.example.com/a", scopes: "x" }, "oauth_provider_invalid"],
      [{ slug: "gh", kind: "oauth2", authorization_endpoint: "https://gh.example.com/a", token_endpoint: "https://gh.example.com/t", userinfo_endpoint: "https://gh.example.com/u" }, "oauth_provider_invalid"],
      [{ slug: "o2", kind: "oidc", issuer: IDP_ISSUER, scopes: "profile email" }, "oauth_provider_invalid"],
      [{ slug: "o3", kind: "oauth2", authorization_endpoint: "https://intranet.corp/a", token_endpoint: "https://gh.example.com/t", userinfo_endpoint: "https://gh.example.com/u", scopes: "x" }, "oauth_url_rejected"],
      [{ slug: "Bad Slug", kind: "oidc", issuer: IDP_ISSUER }, "validation_error"],
    ];
    for (const [fields, code] of cases) {
      const res = await api("/api/admin/oauth-providers", { json: { ...base, ...fields }, cookie: adminCookie });
      expect(res.status, JSON.stringify(fields)).toBe(400);
      expect(await errorCode(res)).toBe(code);
    }
  });

  it("PUT 省略 client_secret 保留原值、提供则更换；停用后提示只靠它登录的用户", async () => {
    const provider = await createProvider(adminCookie);
    const before = await env.APP_DB.prepare("SELECT client_secret_enc FROM oauth_providers").first<{ client_secret_enc: string }>();
    const lonely = await createUser({ username: "lonely" });
    await env.APP_DB.prepare("UPDATE users SET password_hash = NULL WHERE id = ?").bind(lonely).run();
    await linkIdentity(lonely, provider.id, "s-lonely");
    const withPassword = await createUser({ username: "safe" });
    await linkIdentity(withPassword, provider.id, "s-safe");

    const { id: _id, client_secret_set: _set, callback_url: _cb, created_at: _c, updated_at: _u, ...editable } = provider;
    const keep = await api(`/api/admin/oauth-providers/${provider.id}`, { method: "PUT", json: { ...editable, name: "Renamed" }, cookie: adminCookie });
    expect(keep.status).toBe(200);
    const kept = (await keep.json()) as OAuthProviderChangeResponse;
    expect(kept.provider?.name).toBe("Renamed");
    expect(kept.users_without_login_method).toEqual([]);
    const afterKeep = await env.APP_DB.prepare("SELECT client_secret_enc FROM oauth_providers").first<{ client_secret_enc: string }>();
    expect(afterKeep?.client_secret_enc).toBe(before?.client_secret_enc);

    const disable = await api(`/api/admin/oauth-providers/${provider.id}`, {
      method: "PUT",
      json: { ...editable, enabled: false, client_secret: "rotated-secret" },
      cookie: adminCookie,
    });
    expect(((await disable.json()) as OAuthProviderChangeResponse).users_without_login_method).toEqual([lonely]);
    const afterRotate = await env.APP_DB.prepare("SELECT client_secret_enc FROM oauth_providers").first<{ client_secret_enc: string }>();
    expect(afterRotate?.client_secret_enc).not.toBe(before?.client_secret_enc);
    expect((await auditRows("oauth_provider.update")).at(-1)?.detail).toContain('"client_secret_changed":true');
  });

  it("DELETE 级联删除绑定并提示没有登录方式的用户；非管理员 403", async () => {
    const provider = await createProvider(adminCookie);
    const lonely = await createUser({ username: "lonely" });
    await env.APP_DB.prepare("UPDATE users SET password_hash = NULL WHERE id = ?").bind(lonely).run();
    await linkIdentity(lonely, provider.id, "s-lonely");

    const userCookie = (await createSessionCookie(await createUser({ username: "plain" }))).cookie;
    expect((await api(`/api/admin/oauth-providers/${provider.id}`, { method: "DELETE", cookie: userCookie })).status).toBe(403);

    const res = await api(`/api/admin/oauth-providers/${provider.id}`, { method: "DELETE", cookie: adminCookie });
    expect(await res.json()).toEqual({ provider: null, users_without_login_method: [lonely] });
    expect(await identityCount()).toBe(0);
    expect(await auditRows("oauth_provider.delete")).toHaveLength(1);
  });
});

describe("发现文档（防 SSRF）", () => {
  it("合法文档：返回端点", async () => {
    const res = await discover(IDP_ISSUER);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ issuer: IDP_ISSUER, jwks_uri: `${IDP_ISSUER}/jwks` });
  });

  it("拒绝 http、IP 字面量、内网与回环主机名，且不发出请求", async () => {
    expect((await discover("http://idp.example.com")).status).toBe(400);
    const rejected = [
      "https://127.0.0.1",
      "https://2130706433",
      "https://0x7f.1",
      "https://[::1]",
      "https://10.0.0.8:8443/realms/x",
      "https://localhost",
      "https://auth.localhost",
      "https://metadata.google.internal",
      "https://printer.local",
      "https://intranet",
      "https://user:pass@idp.example.com",
    ];
    for (const issuer of rejected) {
      const res = await discover(issuer);
      expect(res.status, issuer).toBe(400);
      expect(["oauth_url_rejected", "validation_error"], issuer).toContain(await errorCode(res));
    }
    expect(idp.requests).toHaveLength(0);
  });

  it("不跟随重定向、超大响应、非 JSON、issuer 不一致、缺字段、端点指向内网：422", async () => {
    const url = `${IDP_ISSUER}/.well-known/openid-configuration`;
    const doc = idp.discoveryDocument();
    const cases: Array<() => Response> = [
      () => new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/" } }),
      () => new Response("x".repeat(OAUTH_FETCH_MAX_BYTES + 1)),
      () => new Response("<html>"),
      () => Response.json({ ...doc, issuer: "https://other.example.com" }),
      () => Response.json({ issuer: IDP_ISSUER }),
      () => Response.json({ ...doc, jwks_uri: "https://169.254.169.254/keys" }),
      () => Response.json({ ...doc, code_challenge_methods_supported: ["plain"] }),
    ];
    for (const [index, make] of cases.entries()) {
      idp.overrides.set(url, make);
      const res = await discover(IDP_ISSUER);
      expect(res.status, String(index)).toBe(422);
      expect(await errorCode(res)).toBe("oauth_discovery_failed");
    }
  });
});

describe("公开配置的登录方式", () => {
  it("默认含 password 与 passkey；有启用的提供方时加入 oauth，只暴露 slug、名称、图标", async () => {
    let config = (await (await api("/api/public/config")).json()) as PublicConfig;
    expect(config.login_methods).toEqual(["password", "passkey"]);
    expect(config.oauth_providers).toEqual([]);

    await createProvider(adminCookie, { icon: "github", sort: 2 });
    await createProvider(adminCookie, { slug: "first", name: "First", sort: 1 });
    await createProvider(adminCookie, { slug: "off", name: "Off", enabled: false });
    config = (await (await api("/api/public/config")).json()) as PublicConfig;
    expect(config.login_methods).toEqual(["password", "passkey", "oauth"]);
    expect(config.oauth_providers).toEqual([
      { slug: "first", name: "First", icon: null },
      { slug: "idp", name: "Test IdP", icon: "github" },
    ]);
    expect(JSON.stringify(config)).not.toMatch(/client|issuer|secret/);
  });

  it("设置里关掉 oauth：不暴露提供方，发起登录回 provider_unavailable", async () => {
    await createProvider(adminCookie);
    await env.APP_DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('auth.login_methods', '[\"password\"]', 0)").run();
    const config = (await (await api("/api/public/config")).json()) as PublicConfig;
    expect(config).toMatchObject({ login_methods: ["password"], oauth_providers: [] });
    const start = await api("/api/auth/oauth/idp/start");
    expect(new URL(start.headers.get("Location") ?? "").searchParams.get("oauth")).toBe("provider_unavailable");
  });
});
