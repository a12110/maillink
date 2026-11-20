import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeIdp } from "./fake-idp";
import { adminSession, api, createSessionCookie, createUser, resetApp, sidSetCookie, TEST_PASSWORD } from "./helpers";
import { createProvider, linkIdentity, runOAuth } from "./oauth-helpers";
import { codeAt, enableTotp, passwordStep } from "./security-helpers";
import { DEFAULTS, errorCode, putSettings, saveSettings } from "./settings-helpers";

// 管理员强制 2FA 收紧（M7b）：只看会话的 auth_methods（totp / recovery / passkey），
// 开启时已启用 TOTP 的管理员走 OAuth 也进入 pending_auth；防锁死按"能否产生合格会话"判定。

let admin: { id: number; cookie: string };
let totpSecret = "";

beforeEach(async () => {
  await resetApp();
  admin = await adminSession();
  ({ secret: totpSecret } = await enableTotp(admin.cookie));
  await saveSettings(admin.cookie, "security", { ...DEFAULTS.security, admin_require_2fa: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const adminStatus = async (cookie: string): Promise<number> => (await api("/api/admin/users", { cookie })).status;

async function sessionMethods(cookie: string): Promise<string[]> {
  const res = await api("/api/auth/session", { cookie });
  return ((await res.json()) as { auth_methods: string[] }).auth_methods;
}

/** 密码 + TOTP 两步登录，返回 sid Cookie */
async function loginWithTotp(username: string, secret: string): Promise<string> {
  const pending = await passwordStep(username, TEST_PASSWORD);
  const res = await api("/api/auth/mfa/totp", { json: { code: await codeAt(secret, 1) }, cookie: pending });
  expect(res.status, await res.clone().text()).toBe(200);
  return sidSetCookie(res)?.split(";")[0] ?? "";
}

describe("只看会话的 auth_methods", () => {
  it("已启用 TOTP 但会话是单因素（password / oauth:*）→ 403；两步登录得到的会话 → 200", async () => {
    // 启用 TOTP 的那个会话已补记 totp
    expect(await sessionMethods(admin.cookie)).toEqual(["password", "totp"]);
    expect(await adminStatus(admin.cookie)).toBe(200);

    const single = await createSessionCookie(admin.id);
    expect(await adminStatus(single.cookie)).toBe(403);
    expect(await errorCode(await api("/api/admin/users", { cookie: single.cookie }))).toBe("admin_2fa_required");
    const session = await api("/api/auth/session", { cookie: single.cookie });
    expect(((await session.json()) as { admin_2fa_required: boolean }).admin_2fa_required).toBe(true);

    await env.APP_DB.prepare("UPDATE sessions SET auth_methods = 'oauth:idp' WHERE id_hash = ?").bind(single.idHash).run();
    expect(await adminStatus(single.cookie)).toBe(403);

    const twoStep = await loginWithTotp("root", totpSecret);
    expect(await sessionMethods(twoStep)).toEqual(["password", "totp"]);
    expect(await adminStatus(twoStep)).toBe(200);
  });

  it("恢复码登录的会话（password,recovery）合格；关闭该设置后单因素会话恢复访问", async () => {
    const { recoveryCodes } = await enableTotp((await createSessionCookie(await createUser({ username: "root2", role: "admin" }))).cookie);
    const pending = await passwordStep("root2", TEST_PASSWORD);
    const res = await api("/api/auth/mfa/recovery", { json: { code: recoveryCodes[0] }, cookie: pending });
    expect(res.status).toBe(200);
    const sid = sidSetCookie(res)?.split(";")[0] ?? "";
    expect(await sessionMethods(sid)).toEqual(["password", "recovery"]);
    expect(await adminStatus(sid)).toBe(200);

    const single = await createSessionCookie(admin.id);
    expect(await adminStatus(single.cookie)).toBe(403);
    await saveSettings(admin.cookie, "security", { ...DEFAULTS.security, admin_require_2fa: false });
    expect(await adminStatus(single.cookie)).toBe(200);
  });

  it("账号页关闭 TOTP：当前会话去掉 totp，立即被挡；再启用后同一会话放行", async () => {
    const res = await api("/api/me/totp", { method: "DELETE", json: { password: TEST_PASSWORD }, cookie: admin.cookie });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await sessionMethods(admin.cookie)).toEqual(["password"]);
    expect(await adminStatus(admin.cookie)).toBe(403);
    // /api/me 不受影响，可以重新启用
    await enableTotp(admin.cookie);
    expect(await adminStatus(admin.cookie)).toBe(200);
  });

  it("管理员在管理端清掉自己的 2FA：保留的当前会话同样去掉 totp", async () => {
    const res = await api(`/api/admin/users/${admin.id}/totp`, { method: "DELETE", cookie: admin.cookie });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await sessionMethods(admin.cookie)).toEqual(["password"]);
    expect(await adminStatus(admin.cookie)).toBe(403);
  });
});

describe("开启时管理员走 OAuth 进入 pending_auth", () => {
  let idp: FakeIdp;
  const ADMIN_CLAIMS = { sub: "idp-admin", email: "root@example.com", email_verified: true, name: "Root" };
  const USER_CLAIMS = { sub: "idp-user", email: "bob@example.com", email_verified: true, name: "Bob" };
  let bob = 0;

  beforeEach(async () => {
    idp = await FakeIdp.create();
    idp.install();
    const provider = await createProvider(admin.cookie);
    await linkIdentity(admin.id, provider.id, ADMIN_CLAIMS.sub);
    bob = await createUser({ username: "bob" });
    await linkIdentity(bob, provider.id, USER_CLAIMS.sub);
    await enableTotp((await createSessionCookie(bob)).cookie);
  });

  it("已启用 TOTP 的管理员：mfa_required，不发会话；第二步后会话为 oauth:idp,totp 且能进管理端", async () => {
    const flow = await runOAuth(idp, ADMIN_CLAIMS);
    expect(flow.result).toBe("mfa_required");
    expect(sidSetCookie(flow.res)).toBeUndefined();
    const pending = flow.res.headers.getSetCookie().find((line) => line.startsWith("pending_auth="))?.split(";")[0] ?? "";
    const res = await api("/api/auth/mfa/totp", { json: { code: await codeAt(totpSecret, 1) }, cookie: pending });
    expect(res.status).toBe(200);
    const sid = sidSetCookie(res)?.split(";")[0] ?? "";
    expect(await sessionMethods(sid)).toEqual(["oauth:idp", "totp"]);
    expect(await adminStatus(sid)).toBe(200);
  });

  it("普通用户不受影响（oauth_require_2fa 仍为 false）：直接发会话", async () => {
    const flow = await runOAuth(idp, USER_CLAIMS);
    expect(flow.result).toBe("ok");
    expect(sidSetCookie(flow.res)).toBeDefined();
  });

  it("设置关闭时，已启用 TOTP 的管理员走 OAuth 直接发会话（D7 默认）", async () => {
    await saveSettings(admin.cookie, "security", { ...DEFAULTS.security, admin_require_2fa: false });
    const flow = await runOAuth(idp, ADMIN_CLAIMS);
    expect(flow.result).toBe("ok");
  });
});

describe("防锁死：没有管理员能产生合格会话时拒绝", () => {
  beforeEach(async () => {
    await saveSettings(admin.cookie, "security", { ...DEFAULTS.security, admin_require_2fa: false });
  });

  it("唯一启用 TOTP 的管理员没有密码、也没绑定 OAuth：拒绝开启", async () => {
    await env.APP_DB.prepare("UPDATE users SET password_hash = NULL WHERE id = ?").bind(admin.id).run();
    const res = await putSettings(admin.cookie, "security", { ...DEFAULTS.security, admin_require_2fa: true });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("admin_2fa_lockout");
  });

  it("唯一启用 TOTP 的管理员只能用密码完成第一步：开启后只留 OAuth 登录被拒绝（另一个管理员能登录但没有 2FA）", async () => {
    const idp = await FakeIdp.create();
    idp.install();
    const provider = await createProvider(admin.cookie);
    const other = await createUser({ username: "root2", role: "admin" });
    await linkIdentity(other, provider.id, "idp-root2");
    await saveSettings(admin.cookie, "security", { ...DEFAULTS.security, admin_require_2fa: true });

    const res = await putSettings(admin.cookie, "auth", { ...DEFAULTS.auth, login_methods: ["oauth"] });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("admin_2fa_lockout");

    // 通行密钥开放且该管理员登记了通行密钥：仍能产生合格会话，允许
    await env.APP_DB
      .prepare("INSERT INTO user_passkeys (user_id, name, credential_id, public_key, created_at) VALUES (?, 'k', 'cred', 'pk', 0)")
      .bind(admin.id)
      .run();
    expect((await putSettings(admin.cookie, "auth", { ...DEFAULTS.auth, login_methods: ["passkey", "oauth"] })).status).toBe(200);
  });

  it("已启用 TOTP 的管理员只绑定了 OAuth（无密码）且 OAuth 开放：允许开启", async () => {
    const idp = await FakeIdp.create();
    idp.install();
    const provider = await createProvider(admin.cookie);
    await linkIdentity(admin.id, provider.id, "idp-admin");
    await env.APP_DB.prepare("UPDATE users SET password_hash = NULL WHERE id = ?").bind(admin.id).run();
    const res = await putSettings(admin.cookie, "security", { ...DEFAULTS.security, admin_require_2fa: true });
    expect(res.status, await res.clone().text()).toBe(200);
  });
});
