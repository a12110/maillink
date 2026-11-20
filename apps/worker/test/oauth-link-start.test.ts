import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECENT_AUTH_SEC } from "../src/constants";
import { TEST_PASSWORD, adminSession, api, auditRows, createSessionCookie, createUser, resetApp } from "./helpers";
import { FakeIdp, IDP_ISSUER } from "./fake-idp";
import { createProvider, finishCallback, identityCount, startLink } from "./oauth-helpers";
import { cookieFrom, joinCookies, nowSec, type ErrorBody } from "./security-helpers";

// FIN-A：OAuth 绑定不能被跨站发起。POST /api/auth/oauth/:slug/link 经全局 CSRF 检查、要求再确认，
// 返回 authorize_url；state 绑定到当前用户与会话；GET …/start?mode=link 明确拒绝。

const CLAIMS = { sub: "idp-user-1", email: "alice@example.com", email_verified: true, name: "Alice" };
const LINK_PATH = "/api/auth/oauth/idp/link";

let idp: FakeIdp;
let alice: number;
let aliceCookie: string;

beforeEach(async () => {
  await resetApp();
  idp = await FakeIdp.create();
  idp.install();
  await createProvider((await adminSession()).cookie);
  alice = await createUser({ username: "alice" });
  aliceCookie = (await createSessionCookie(alice)).cookie;
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function expectRejected(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  expect(((await res.json()) as ErrorBody).error.code).toBe(code);
  expect(cookieFrom(res, "oauth_flow")).toBeUndefined();
}

describe("发起绑定：跨站与再确认", () => {
  it("跨站 Origin、缺 Origin、缺 CSRF 头都 403，不写流程 Cookie、不写审计", async () => {
    const body = { password: TEST_PASSWORD };
    await expectRejected(await api(LINK_PATH, { json: body, cookie: aliceCookie, origin: "https://evil.example" }), 403, "csrf_origin_mismatch");
    await expectRejected(await api(LINK_PATH, { json: body, cookie: aliceCookie, origin: false }), 403, "csrf_origin_mismatch");
    await expectRejected(await api(LINK_PATH, { json: body, cookie: aliceCookie, csrf: false }), 403, "csrf_header_missing");
    expect(await auditRows("auth.identity_link_start")).toHaveLength(0);
  });

  it("GET …/start?mode=link 明确拒绝（400 oauth_link_requires_post），不 302、不写流程 Cookie；mode=login 照旧 302", async () => {
    const res = await api("/api/auth/oauth/idp/start?mode=link", { cookie: aliceCookie });
    expect(res.headers.get("Location")).toBeNull();
    await expectRejected(res, 400, "oauth_link_requires_post");
    expect((await api("/api/auth/oauth/idp/start?mode=login")).status).toBe(302);
  });

  it("未再确认 reauth_required、密码错误 reauth_failed（写 auth.reauth_failed），都不发起", async () => {
    await expectRejected(await api(LINK_PATH, { json: {}, cookie: aliceCookie }), 400, "reauth_required");
    await expectRejected(await api(LINK_PATH, { json: { password: "wrong-password-1" }, cookie: aliceCookie }), 400, "reauth_failed");
    const failed = await auditRows("auth.reauth_failed");
    expect(failed.map((row) => JSON.parse(row.detail ?? "{}"))).toEqual([{ method: "password", purpose: "oauth_link" }]);
    expect(await auditRows("auth.identity_link_start")).toHaveLength(0);
  });

  it("没有密码的账号：最近登录可直接发起（{}），会话超过再确认窗口则要求再确认", async () => {
    await env.APP_DB.prepare("UPDATE users SET password_hash = NULL WHERE id = ?").bind(alice).run();
    expect((await api(LINK_PATH, { json: {}, cookie: aliceCookie })).status).toBe(200);
    const stale = (await createSessionCookie(alice, { created_at: nowSec() - RECENT_AUTH_SEC - 1 })).cookie;
    await expectRejected(await api(LINK_PATH, { json: {}, cookie: stale }), 400, "reauth_required");
  });

  it("未登录 401；提供方不存在或停用 404 provider_unavailable", async () => {
    expect((await api(LINK_PATH, { json: { password: TEST_PASSWORD } })).status).toBe(401);
    await expectRejected(await api("/api/auth/oauth/nope/link", { json: { password: TEST_PASSWORD }, cookie: aliceCookie }), 404, "provider_unavailable");
    await env.APP_DB.prepare("UPDATE oauth_providers SET enabled = 0").run();
    await expectRejected(await api(LINK_PATH, { json: { password: TEST_PASSWORD }, cookie: aliceCookie }), 404, "provider_unavailable");
  });
});

describe("发起绑定：正常流程与 state 绑定会话", () => {
  it("返回 authorize_url（提供方授权端点、state、PKCE、固定回调），no-store；审计发起与完成，不记 state / code", async () => {
    const res = await api(LINK_PATH, { json: { password: TEST_PASSWORD }, cookie: aliceCookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const url = new URL(((await res.json()) as { authorize_url: string }).authorize_url);
    expect(url.origin + url.pathname).toBe(`${IDP_ISSUER}/authorize`);
    const state = url.searchParams.get("state") ?? "";
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(`${new URL(env.PUBLIC_ORIGIN).origin}/api/auth/oauth/idp/callback`);
    const flowCookie = cookieFrom(res, "oauth_flow");
    expect(flowCookie).toBeDefined();

    const callbackPath = idp.authorize(url.toString(), CLAIMS);
    const done = await finishCallback(callbackPath, joinCookies(aliceCookie, flowCookie));
    expect(done.result).toBe("linked");
    expect(done.location.pathname).toBe("/account");
    expect(await identityCount(alice)).toBe(1);

    const started = await auditRows("auth.identity_link_start");
    expect(started.map((row) => ({ actor: row.actor_user_id, detail: JSON.parse(row.detail ?? "{}") }))).toEqual([
      { actor: alice, detail: { provider: "idp" } },
    ]);
    const code = new URL(callbackPath, "https://x.invalid").searchParams.get("code") ?? "-";
    for (const row of [...started, ...(await auditRows("auth.identity_link"))]) {
      expect(row.detail ?? "").not.toContain(state);
      expect(row.detail ?? "").not.toContain(code);
    }
  });

  it("state 绑定会话：同一用户换个会话、或回调时未登录，都 link_requires_login 并写审计 session_mismatch", async () => {
    const other = (await createSessionCookie(alice)).cookie;
    const first = await startLink(aliceCookie);
    const sameUserOtherSession = await finishCallback(idp.authorize(first.authorizeUrl.toString(), CLAIMS), joinCookies(other, first.flowCookie));
    expect(sameUserOtherSession.result).toBe("link_requires_login");

    const second = await startLink(aliceCookie);
    const loggedOut = await finishCallback(idp.authorize(second.authorizeUrl.toString(), CLAIMS), second.flowCookie);
    expect(loggedOut.result).toBe("link_requires_login");

    expect(await identityCount()).toBe(0);
    const rejected = await auditRows("auth.identity_link_rejected");
    expect(rejected.map((row) => ({ actor: row.actor_user_id, detail: JSON.parse(row.detail ?? "{}") }))).toEqual([
      { actor: alice, detail: { provider: "idp", reason: "session_mismatch" } },
      { actor: alice, detail: { provider: "idp", reason: "session_mismatch" } },
    ]);
  });

  it("登录流程的 state 不能拿来绑定：mode=login 的回调走登录分支，不会绑到当前会话用户", async () => {
    const start = await api("/api/auth/oauth/idp/start?mode=login", { cookie: aliceCookie });
    const flowCookie = cookieFrom(start, "oauth_flow");
    const done = await finishCallback(idp.authorize(start.headers.get("Location") ?? "", CLAIMS), joinCookies(aliceCookie, flowCookie));
    expect(done.result).toBe("not_linked");
    expect(await identityCount()).toBe(0);
  });
});
