import { env } from "cloudflare:workers";
import type { MyPasskey } from "@maillink/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_PASSWORD, api, auditRows, createUser, login, resetApp, sidSetCookie } from "./helpers";
import type { ErrorBody } from "./security-helpers";
import { cookieFrom, enableTotp, joinCookies } from "./security-helpers";
import type { AssertionOverrides } from "./soft-authenticator";
import { SoftAuthenticator } from "./soft-authenticator";

const ORIGIN = env.PUBLIC_ORIGIN;
const RP_ID = new URL(ORIGIN).hostname;

type CreationOptions = {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string };
  authenticatorSelection: { residentKey: string; userVerification: string };
  excludeCredentials: Array<{ id: string }>;
};

async function registerPasskey(
  cookie: string,
  device: SoftAuthenticator,
  origin = ORIGIN,
): Promise<{ res: Response; options: CreationOptions; challengeCookie: string }> {
  const optionsRes = await api("/api/me/passkeys/options", { json: { password: TEST_PASSWORD }, cookie });
  expect(optionsRes.status).toBe(200);
  const options = (await optionsRes.json()) as CreationOptions;
  const challengeCookie = cookieFrom(optionsRes, "passkey_reg") ?? "";
  const response = await device.register(options, origin);
  const res = await api("/api/me/passkeys/verify", { json: { response, name: "笔记本" }, cookie: joinCookies(cookie, challengeCookie) });
  return { res, options, challengeCookie };
}

async function passkeyLogin(
  device: SoftAuthenticator,
  overrides: AssertionOverrides = {},
): Promise<{ res: Response; challengeCookie: string; body: unknown }> {
  const optionsRes = await api("/api/auth/passkey/options", { method: "POST" });
  expect(optionsRes.status).toBe(200);
  const options = (await optionsRes.json()) as { challenge: string; rpId: string; userVerification: string };
  expect(options).toMatchObject({ rpId: RP_ID, userVerification: "required" });
  const challengeCookie = cookieFrom(optionsRes, "passkey_auth") ?? "";
  const body = { response: await device.assert(options, ORIGIN, overrides) };
  const res = await api("/api/auth/passkey/verify", { json: body, cookie: challengeCookie });
  return { res, challengeCookie, body };
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as ErrorBody).error.code;
}

describe("通行密钥：注册", () => {
  beforeEach(resetApp);

  it("可发现凭据 + 必须用户验证；注册成功入库并写审计；challenge 不能重用", async () => {
    const id = await createUser({ username: "alice" });
    const cookie = await login("alice");
    const device = await SoftAuthenticator.create();
    const { res, options, challengeCookie } = await registerPasskey(cookie, device);

    expect(options.rp.id).toBe(RP_ID);
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    // user handle 是 32 字节 HMAC，不是内部 id 或用户名
    expect(options.user.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: "笔记本", transports: ["internal"] });
    const row = await env.APP_DB.prepare("SELECT credential_id, counter FROM user_passkeys WHERE user_id = ?").bind(id).first();
    expect(row).toEqual({ credential_id: device.id, counter: 0 });
    expect(await auditRows("auth.passkey_add")).toHaveLength(1);

    const replay = await api("/api/me/passkeys/verify", {
      json: { response: await device.register(options, ORIGIN) },
      cookie: joinCookies(cookie, challengeCookie),
    });
    expect(replay.status).toBe(400);
    expect(await errorCode(replay)).toBe("passkey_challenge_invalid");

    const second = await api("/api/me/passkeys/options", { json: { password: TEST_PASSWORD }, cookie });
    expect(((await second.json()) as CreationOptions).excludeCredentials.map((item) => item.id)).toEqual([device.id]);
  });

  it("origin 不符、challenge 属于别的用户都拒绝", async () => {
    await createUser({ username: "alice" });
    await createUser({ username: "bob" });
    const alice = await login("alice");
    const bob = await login("bob");

    const wrongOrigin = await registerPasskey(alice, await SoftAuthenticator.create(), "https://evil.example");
    expect(wrongOrigin.res.status).toBe(400);
    expect(await errorCode(wrongOrigin.res)).toBe("passkey_verification_failed");

    const optionsRes = await api("/api/me/passkeys/options", { json: { password: TEST_PASSWORD }, cookie: alice });
    const options = (await optionsRes.json()) as CreationOptions;
    const response = await (await SoftAuthenticator.create()).register(options, ORIGIN);
    const stolen = await api("/api/me/passkeys/verify", { json: { response }, cookie: joinCookies(bob, cookieFrom(optionsRes, "passkey_reg")) });
    expect(stolen.status).toBe(400);
    expect(await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM user_passkeys").first()).toEqual({ n: 0 });
  });
});

describe("通行密钥：登录", () => {
  beforeEach(resetApp);

  it("成功：auth_methods 为 passkey，已启用 TOTP 也不再要求；counter 更新", async () => {
    const id = await createUser({ username: "alice" });
    const cookie = await login("alice");
    await enableTotp(cookie);
    const device = await SoftAuthenticator.create();
    expect((await registerPasskey(cookie, device)).res.status).toBe(201);

    const { res } = await passkeyLogin(device, { counter: 7 });
    expect(res.status).toBe(200);
    const sid = sidSetCookie(res)?.split(";")[0] ?? "";
    const session = (await (await api("/api/auth/session", { cookie: sid })).json()) as { auth_methods: string[] };
    expect(session.auth_methods).toEqual(["passkey"]);
    const row = await env.APP_DB.prepare("SELECT counter, last_used_at FROM user_passkeys WHERE user_id = ?").bind(id).first<{ counter: number; last_used_at: number }>();
    expect(row?.counter).toBe(7);
    expect(row?.last_used_at).not.toBeNull();
    expect((await auditRows("auth.login")).at(-1)?.detail).toContain("passkey");
  });

  it("challenge 只能用一次", async () => {
    await createUser({ username: "alice" });
    const device = await SoftAuthenticator.create();
    await registerPasskey(await login("alice"), device);

    const first = await passkeyLogin(device);
    expect(first.res.status).toBe(200);
    expect(first.res.headers.getSetCookie().some((line) => line.startsWith("passkey_auth=;") || /passkey_auth=.*Max-Age=0/.test(line))).toBe(true);
    const replay = await api("/api/auth/passkey/verify", { json: first.body, cookie: first.challengeCookie });
    expect(replay.status).toBe(400);
    expect(await errorCode(replay)).toBe("passkey_challenge_invalid");
  });

  it("同一 challenge 并发提交两次：只有一个成功", async () => {
    await createUser({ username: "alice" });
    const device = await SoftAuthenticator.create();
    await registerPasskey(await login("alice"), device);
    const optionsRes = await api("/api/auth/passkey/options", { method: "POST" });
    const options = (await optionsRes.json()) as { challenge: string; rpId: string };
    const cookie = cookieFrom(optionsRes, "passkey_auth") ?? "";
    const body = { response: await device.assert(options, ORIGIN, { counter: 1 }) };
    const results = await Promise.all([1, 2].map(() => api("/api/auth/passkey/verify", { json: body, cookie })));
    expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
  });

  it("counter 回退或不增长：拒绝并写审计", async () => {
    await createUser({ username: "alice" });
    const device = await SoftAuthenticator.create();
    await registerPasskey(await login("alice"), device);

    expect((await passkeyLogin(device, { counter: 5 })).res.status).toBe(200);
    for (const counter of [5, 3]) {
      const { res } = await passkeyLogin(device, { counter });
      expect(res.status, String(counter)).toBe(401);
      expect(await errorCode(res)).toBe("passkey_invalid");
    }
    const rollbacks = await auditRows("auth.passkey_counter_rollback");
    expect(rollbacks).toHaveLength(2);
    expect(rollbacks[0]?.detail).toContain('"stored_counter":5');
    expect((await passkeyLogin(device, { counter: 6 })).res.status).toBe(200);
  });

  it("origin 不符、challenge 不符、未做用户验证、userHandle 不符、未知凭据都拒绝", async () => {
    await createUser({ username: "alice" });
    const device = await SoftAuthenticator.create();
    await registerPasskey(await login("alice"), device);

    const cases: AssertionOverrides[] = [
      { origin: "https://evil.example" },
      { challenge: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
      { userVerified: false },
      { userHandle: "AAAA" },
    ];
    for (const overrides of cases) {
      const { res } = await passkeyLogin(device, overrides);
      expect(res.status, JSON.stringify(overrides)).toBe(401);
    }
    const stranger = await SoftAuthenticator.create();
    expect((await passkeyLogin(stranger)).res.status).toBe(401);
    const reasons = (await auditRows("auth.login_failed")).map((row) => JSON.parse(row.detail ?? "{}").reason);
    expect(reasons).toEqual(["verification_failed", "verification_failed", "verification_failed", "user_handle_mismatch", "unknown_credential"]);
  });

  it("禁用用户拒绝；登录方式未启用时 403", async () => {
    const id = await createUser({ username: "alice" });
    const device = await SoftAuthenticator.create();
    await registerPasskey(await login("alice"), device);
    await env.APP_DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind(id).run();
    expect((await passkeyLogin(device)).res.status).toBe(401);

    await env.APP_DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('auth.login_methods', '[\"password\"]', 0)").run();
    expect((await api("/api/auth/passkey/options", { method: "POST" })).status).toBe(403);
  });
});

describe("通行密钥：管理", () => {
  beforeEach(resetApp);

  it("列表、改名、删除；别人的 404；只剩这一种登录方式时不能删", async () => {
    const id = await createUser({ username: "alice" });
    await createUser({ username: "bob" });
    const cookie = await login("alice");
    const bob = await login("bob");
    await registerPasskey(cookie, await SoftAuthenticator.create());
    await registerPasskey(cookie, await SoftAuthenticator.create());
    const items = ((await (await api("/api/me/passkeys", { cookie })).json()) as { items: MyPasskey[] }).items;
    expect(items).toHaveLength(2);
    const [first, second] = items;

    expect((await api(`/api/me/passkeys/${first?.id}`, { method: "PATCH", json: { name: "手机" }, cookie })).status).toBe(200);
    expect((await api(`/api/me/passkeys/${first?.id}`, { method: "PATCH", json: { name: "x" }, cookie: bob })).status).toBe(404);
    expect((await api(`/api/me/passkeys/${first?.id}`, { method: "DELETE", cookie: bob })).status).toBe(404);

    // 去掉密码后，两把通行密钥只能删掉一把
    await env.APP_DB.prepare("UPDATE users SET password_hash = NULL WHERE id = ?").bind(id).run();
    expect((await api(`/api/me/passkeys/${first?.id}`, { method: "DELETE", cookie })).status).toBe(200);
    const last = await api(`/api/me/passkeys/${second?.id}`, { method: "DELETE", cookie });
    expect(last.status).toBe(409);
    expect(await errorCode(last)).toBe("last_login_method");
    expect(await auditRows("auth.passkey_remove")).toHaveLength(1);
    expect(await auditRows("auth.passkey_rename")).toHaveLength(1);
  });
});
