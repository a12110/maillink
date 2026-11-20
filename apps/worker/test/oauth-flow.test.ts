import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminSession, api, auditRows, createSessionCookie, createUser, resetApp, sidSetCookie } from "./helpers";
import { FakeIdp, IDP_ISSUER } from "./fake-idp";
import type { IdTokenTweaks } from "./fake-idp";
import { createProvider, finishCallback, identityCount, linkIdentity, runOAuth, startLink } from "./oauth-helpers";
import { cookieCleared, joinCookies } from "./security-helpers";

const CLAIMS = { sub: "idp-user-1", email: "alice@example.com", email_verified: true, name: "Alice" };

let idp: FakeIdp;
let providerId: number;

async function sessionMethods(res: Response): Promise<string[]> {
  const sid = sidSetCookie(res)?.split(";")[0] ?? "";
  const session = await api("/api/auth/session", { cookie: sid });
  return ((await session.json()) as { auth_methods: string[] }).auth_methods;
}

beforeEach(async () => {
  await resetApp();
  idp = await FakeIdp.create();
  idp.install();
  const admin = await adminSession();
  providerId = (await createProvider(admin.cookie)).id;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("OAuth：已绑定身份登录", () => {
  it("授权地址带 PKCE S256、state、nonce、固定回调；回调后登录，auth_methods 为 oauth:<slug>，流程 Cookie 清除", async () => {
    const userId = await createUser({ username: "alice" });
    await linkIdentity(userId, providerId, CLAIMS.sub);

    const flow = await runOAuth(idp, CLAIMS);
    const params = flow.authorizeUrl.searchParams;
    expect(flow.authorizeUrl.origin + flow.authorizeUrl.pathname).toBe(`${IDP_ISSUER}/authorize`);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get("redirect_uri")).toBe(`${new URL(env.PUBLIC_ORIGIN).origin}/api/auth/oauth/idp/callback`);
    expect(params.get("scope")).toBe("openid profile email");
    expect(flow.flowCookie).not.toContain(params.get("state") ?? "-");

    expect(flow.result).toBe("ok");
    expect(flow.location.pathname).toBe("/login");
    expect(flow.location.searchParams.get("provider")).toBe("idp");
    expect(flow.location.search).not.toMatch(/code=|token/);
    expect(cookieCleared(flow.res, "oauth_flow")).toBe(true);
    expect(await sessionMethods(flow.res)).toEqual(["oauth:idp"]);
    const token = idp.requests.find((item) => item.url.endsWith("/token"));
    expect(token?.headers.get("Authorization")).toMatch(/^Basic /);
    expect((await auditRows("auth.login")).at(-1)?.detail).toContain("oauth:idp");
  });

  it("账号被禁用：account_disabled，不发会话", async () => {
    const userId = await createUser({ username: "alice", status: "disabled" });
    await linkIdentity(userId, providerId, CLAIMS.sub);
    const flow = await runOAuth(idp, CLAIMS);
    expect(flow.result).toBe("account_disabled");
    expect(sidSetCookie(flow.res)).toBeUndefined();
  });

  it("设置要求 OAuth 后仍需 2FA 且用户已启用 TOTP：mfa_required，发 pending_auth 不发会话", async () => {
    const userId = await createUser({ username: "alice" });
    await linkIdentity(userId, providerId, CLAIMS.sub);
    await env.APP_DB.prepare("UPDATE users SET totp_secret_enc = 'x', totp_enabled_at = 1 WHERE id = ?").bind(userId).run();
    await env.APP_DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('auth.oauth_require_2fa', 'true', 0)").run();
    const flow = await runOAuth(idp, CLAIMS);
    expect(flow.result).toBe("mfa_required");
    expect(sidSetCookie(flow.res)).toBeUndefined();
    expect(flow.res.headers.getSetCookie().some((line) => line.startsWith("pending_auth="))).toBe(true);
  });
});

describe("OAuth：state、nonce、id_token 校验", () => {
  beforeEach(async () => {
    await linkIdentity(await createUser({ username: "alice" }), providerId, CLAIMS.sub);
  });

  it("state 不符、缺少流程 Cookie、同一流程回调两次：state_invalid", async () => {
    expect((await runOAuth(idp, CLAIMS, { state: "forged-state" })).result).toBe("state_invalid");

    const ok = await runOAuth(idp, CLAIMS);
    expect(ok.result).toBe("ok");
    const replay = await finishCallback(ok.callbackPath, ok.flowCookie);
    expect(replay.result).toBe("state_invalid");
    expect((await finishCallback(ok.callbackPath, "")).result).toBe("state_invalid");
  });

  const badTokens: Array<[string, IdTokenTweaks]> = [
    ["nonce 不符", { nonce: "other-nonce" }],
    ["iss 错", { iss: "https://evil.example.com" }],
    ["aud 错", { aud: "someone-else" }],
    ["已过期", { expiresIn: -3600 }],
    ["签名错误", { wrongKey: true }],
    ["对称算法 HS256", { alg: "HS256" }],
  ];
  for (const [label, tweaks] of badTokens) {
    it(`id_token ${label}：token_invalid，不发会话`, async () => {
      idp.tweaks = tweaks;
      const flow = await runOAuth(idp, CLAIMS);
      expect(flow.result).toBe("token_invalid");
      expect(sidSetCookie(flow.res)).toBeUndefined();
    });
  }

  it("多受众但 azp 不是本客户端：token_invalid", async () => {
    idp.tweaks = { aud: ["maillink-client", "other"] };
    expect((await runOAuth(idp, { ...CLAIMS, azp: "other" })).result).toBe("token_invalid");
  });

  it("PKCE：授权码对应的 challenge 与本次流程的 verifier 不符（授权码注入）时换 token 失败", async () => {
    const flow = await runOAuth(idp, CLAIMS, { challenge: "attacker-challenge" });
    expect(flow.result).toBe("exchange_failed");
    const token = idp.requests.find((item) => item.url.endsWith("/token"));
    expect(new URLSearchParams(token?.body).get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("用户在 IdP 拒绝：denied", async () => {
    const start = await api("/api/auth/oauth/idp/start");
    const state = new URL(start.headers.get("Location") ?? "").searchParams.get("state");
    const cookie = start.headers.getSetCookie().find((line) => line.startsWith("oauth_flow="))?.split(";")[0] ?? "";
    expect((await finishCallback(`/api/auth/oauth/idp/callback?error=access_denied&state=${state}`, cookie)).result).toBe("denied");
  });

  it("未知或停用的提供方：provider_unavailable", async () => {
    const res = await api("/api/auth/oauth/nope/start");
    expect(new URL(res.headers.get("Location") ?? "").searchParams.get("oauth")).toBe("provider_unavailable");
    await env.APP_DB.prepare("UPDATE oauth_providers SET enabled = 0").run();
    const disabled = await api("/api/auth/oauth/idp/start");
    expect(new URL(disabled.headers.get("Location") ?? "").searchParams.get("oauth")).toBe("provider_unavailable");
  });
});

describe("OAuth：绑定（link 模式）", () => {
  it("已登录用户绑定成功；同一身份已绑给别人则拒绝并写审计", async () => {
    const alice = await createUser({ username: "alice" });
    const bob = await createUser({ username: "bob" });
    const aliceCookie = (await createSessionCookie(alice)).cookie;
    const bobCookie = (await createSessionCookie(bob)).cookie;

    const linked = await runOAuth(idp, CLAIMS, { mode: "link", cookie: aliceCookie });
    expect(linked.result).toBe("linked");
    expect(linked.location.pathname).toBe("/account");
    expect(await identityCount(alice)).toBe(1);
    expect(await auditRows("auth.identity_link")).toHaveLength(1);

    expect((await runOAuth(idp, CLAIMS, { mode: "link", cookie: aliceCookie })).result).toBe("already_linked");
    const taken = await runOAuth(idp, CLAIMS, { mode: "link", cookie: bobCookie });
    expect(taken.result).toBe("identity_taken");
    expect(await identityCount(bob)).toBe(0);
    expect(await auditRows("auth.identity_link_rejected")).toHaveLength(1);
  });

  it("未登录发起绑定：401；回调时会话已换成别人：link_requires_login", async () => {
    const res = await api("/api/auth/oauth/idp/link", { json: { password: "whatever-password" } });
    expect(res.status).toBe(401);

    const alice = (await createSessionCookie(await createUser({ username: "alice" }))).cookie;
    const bob = (await createSessionCookie(await createUser({ username: "bob" }))).cookie;
    const start = await startLink(alice);
    const path = idp.authorize(start.authorizeUrl.toString(), CLAIMS);
    expect((await finishCallback(path, joinCookies(bob, start.flowCookie))).result).toBe("link_requires_login");
    expect(await identityCount()).toBe(0);
  });
});

describe("OAuth：未绑定身份登录", () => {
  it("未开注册：not_linked；提供方允许建号但系统未开注册也不建号", async () => {
    expect((await runOAuth(idp, CLAIMS)).result).toBe("not_linked");
    await env.APP_DB.prepare("UPDATE oauth_providers SET allow_signup = 1").run();
    const flow = await runOAuth(idp, CLAIMS);
    expect(flow.result).toBe("not_linked");
    expect(flow.location.pathname).toBe("/login");
    expect(await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM users").first()).toEqual({ n: 1 });
  });

  it("提供方允许建号且系统开启注册：建 user 账号（无密码）并登录", async () => {
    await env.APP_DB.prepare("UPDATE oauth_providers SET allow_signup = 1").run();
    await env.APP_DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('registration.enabled', 'true', 0)").run();
    const flow = await runOAuth(idp, CLAIMS);
    expect(flow.result).toBe("ok");
    const user = await env.APP_DB
      .prepare("SELECT id, username, role, password_hash, email_lc, email_admin_set FROM users WHERE username = 'alice'")
      .first();
    expect(user).toMatchObject({ role: "user", password_hash: null, email_lc: "alice@example.com", email_admin_set: 0 });
    expect(await identityCount(user?.id as number)).toBe(1);
    expect(await auditRows("auth.oauth_signup")).toHaveLength(1);
  });
});
