import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "../src/constants";
import { runDailyCleanup } from "../src/cron/cleanup";
import { FakeIdp } from "./fake-idp";
import { adminSession, api, auditRows, createSessionCookie, createUser, login, resetApp, sessionCount, sidSetCookie, TEST_PASSWORD } from "./helpers";
import { createProvider, linkIdentity, runOAuth } from "./oauth-helpers";
import { enableTotp } from "./security-helpers";
import { DEFAULTS, errorCode, putSettings, saveSettings } from "./settings-helpers";

const NEW_PASSWORD = "a-brand-new-password";

let admin: { id: number; cookie: string };
beforeEach(async () => {
  await resetApp();
  admin = await adminSession();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** 建 OAuth 提供方要读发现文档：先装本地 IdP 替身 */
async function installIdp(): Promise<FakeIdp> {
  const idp = await FakeIdp.create();
  idp.install();
  return idp;
}

async function openRegistration(): Promise<void> {
  await saveSettings(admin.cookie, "auth", { ...DEFAULTS.auth, registration_enabled: true });
}

describe("注册", () => {
  it("开关默认关闭：404，不创建用户", async () => {
    const res = await api("/api/auth/register", { json: { username: "newbie", password: NEW_PASSWORD } });
    expect(res.status).toBe(404);
    expect(await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'newbie'").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("开启后：201 建 user 角色账号并直接登录；邮箱可选且不算管理员设置；写审计", async () => {
    await openRegistration();
    const res = await api("/api/auth/register", { json: { username: "newbie", password: NEW_PASSWORD, email: "New@Example.com" } });
    expect(res.status).toBe(201);
    const sid = sidSetCookie(res)?.split(";")[0] ?? "";
    expect(sid).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=`));

    const row = await env.APP_DB
      .prepare("SELECT id, role, status, email_lc, email_admin_set, password_hash FROM users WHERE username = 'newbie'")
      .first<{ id: number; role: string; status: string; email_lc: string | null; email_admin_set: number; password_hash: string }>();
    expect(row).toMatchObject({ role: "user", status: "active", email_lc: "new@example.com", email_admin_set: 0 });
    expect(row?.password_hash).toMatch(/^pbkdf2-sha256\$/);

    const session = await api("/api/auth/session", { cookie: sid });
    expect(((await session.json()) as { user: { username: string; role: string } }).user).toMatchObject({ username: "newbie", role: "user" });
    const rows = await auditRows("auth.register");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: row?.id, target_id: String(row?.id) });
    expect(rows[0]?.detail ?? "").not.toContain(NEW_PASSWORD);
  });

  it("不带邮箱也行；用户名重复 409；密码低于硬下限 400", async () => {
    await openRegistration();
    expect((await api("/api/auth/register", { json: { username: "newbie", password: NEW_PASSWORD } })).status).toBe(201);
    const dup = await api("/api/auth/register", { json: { username: "NEWBIE", password: NEW_PASSWORD } });
    expect(dup.status).toBe(409);
    expect(await errorCode(dup)).toBe("username_taken");
    expect((await api("/api/auth/register", { json: { username: "other", password: "short" } })).status).toBe(400);
  });

  it("不能借注册创建管理员：请求里的 role 被拒绝或忽略，角色固定 user", async () => {
    await openRegistration();
    const res = await api("/api/auth/register", { json: { username: "sneaky", password: NEW_PASSWORD, role: "admin" } });
    expect(res.status).toBe(201);
    const row = await env.APP_DB.prepare("SELECT role FROM users WHERE username = 'sneaky'").first<{ role: string }>();
    expect(row?.role).toBe("user");
  });

  it("密码登录被关闭时拒绝注册（否则会建出无法登录的账号）", async () => {
    await installIdp();
    await openRegistration();
    const provider = await createProvider(admin.cookie);
    await linkIdentity(admin.id, provider.id, "admin-subject");
    await saveSettings(admin.cookie, "auth", { registration_enabled: true, login_methods: ["oauth"], oauth_require_2fa: false });
    const res = await api("/api/auth/register", { json: { username: "newbie", password: NEW_PASSWORD } });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("login_method_disabled");
  });
});

describe("密码最小长度（设置）", () => {
  it("调高后：注册、改密、管理员建号与重置都按新下限；登录不受影响", async () => {
    await saveSettings(admin.cookie, "security", { ...DEFAULTS.security, password_min_length: 16 });
    await openRegistration();
    const short = "only-12-chars"; // 13 个字符，满足硬下限 10 但低于 16
    for (const res of [
      await api("/api/auth/register", { json: { username: "newbie", password: short } }),
      await api("/api/admin/users", { json: { username: "made", password: short }, cookie: admin.cookie }),
    ]) {
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("password_too_short");
    }
    const user = await createUser({ username: "carol" });
    const reset = await api(`/api/admin/users/${user}/password`, { json: { password: short }, cookie: admin.cookie });
    expect(await errorCode(reset)).toBe("password_too_short");
    const carol = await login("carol");
    const change = await api("/api/me/password", { json: { current_password: TEST_PASSWORD, new_password: short }, cookie: carol });
    expect(await errorCode(change)).toBe("password_too_short");

    const long = "sixteen-chars-ok!";
    expect((await api("/api/me/password", { json: { current_password: TEST_PASSWORD, new_password: long }, cookie: carol })).status).toBe(200);
    expect((await api("/api/auth/register", { json: { username: "newbie", password: long } })).status).toBe(201);
    // 老用户（密码短于新下限）照常登录
    expect((await api("/api/auth/login", { json: { username: "root", password: TEST_PASSWORD } })).status).toBe(200);
  });
});

describe("密码登录受 auth.login_methods 控制，且不能锁死管理员", () => {
  it("关闭密码后密码登录 403 login_method_disabled（需要管理员有 OAuth 绑定或通行密钥）", async () => {
    await installIdp();
    const provider = await createProvider(admin.cookie);
    await linkIdentity(admin.id, provider.id, "admin-subject");
    await saveSettings(admin.cookie, "auth", { ...DEFAULTS.auth, login_methods: ["oauth"] });
    const res = await api("/api/auth/login", { json: { username: "root", password: TEST_PASSWORD } });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("login_method_disabled");
    expect(sidSetCookie(res)).toBeUndefined();
  });

  it("关闭密码时没有管理员有通行密钥或 OAuth 绑定：400 login_methods_lockout，设置不变", async () => {
    const res = await putSettings(admin.cookie, "auth", { ...DEFAULTS.auth, login_methods: ["passkey", "oauth"] });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("login_methods_lockout");
    expect((await api("/api/public/config")).status).toBe(200);
    expect(((await (await api("/api/public/config")).json()) as { login_methods: string[] }).login_methods).toContain("password");
  });

  it("有一个启用的管理员有通行密钥就够了；其他管理员没有也可以", async () => {
    await createUser({ username: "root2", role: "admin" });
    await env.APP_DB
      .prepare("INSERT INTO user_passkeys (user_id, name, credential_id, public_key, created_at) VALUES (?, 'k', 'cred', 'pk', 0)")
      .bind(admin.id)
      .run();
    const saved = await saveSettings(admin.cookie, "auth", { ...DEFAULTS.auth, login_methods: ["passkey"] });
    expect(saved.login_methods).toEqual(["passkey"]);
  });

  it("绑定的 OAuth 提供方被停用后，该绑定不算可用凭据", async () => {
    await installIdp();
    const provider = await createProvider(admin.cookie);
    await linkIdentity(admin.id, provider.id, "admin-subject");
    await env.APP_DB.prepare("UPDATE oauth_providers SET enabled = 0").run();
    const res = await putSettings(admin.cookie, "auth", { ...DEFAULTS.auth, login_methods: ["oauth"] });
    expect(await errorCode(res)).toBe("login_methods_lockout");
  });
});

describe("OAuth 登录后是否仍需 2FA（auth.oauth_require_2fa）", () => {
  let idp: FakeIdp;
  const CLAIMS = { sub: "idp-user-1", email: "alice@example.com", email_verified: true, name: "Alice" };

  beforeEach(async () => {
    idp = await FakeIdp.create();
    idp.install();
    const provider = await createProvider(admin.cookie);
    const alice = await createUser({ username: "alice" });
    await linkIdentity(alice, provider.id, CLAIMS.sub);
    await enableTotp((await createSessionCookie(alice)).cookie);
  });

  it("默认（false）：已启用 TOTP 的用户 OAuth 登录直接发会话", async () => {
    const flow = await runOAuth(idp, CLAIMS);
    expect(flow.result).toBe("ok");
    expect(sidSetCookie(flow.res)).toBeDefined();
  });

  it("通过设置接口开启（true）：mfa_required，发 pending_auth，不发会话", async () => {
    await saveSettings(admin.cookie, "auth", { ...DEFAULTS.auth, oauth_require_2fa: true });
    const flow = await runOAuth(idp, CLAIMS);
    expect(flow.result).toBe("mfa_required");
    expect(sidSetCookie(flow.res)).toBeUndefined();
    expect(flow.res.headers.getSetCookie().some((line) => line.startsWith("pending_auth="))).toBe(true);
  });
});

describe("会话时长读系统设置", () => {
  const DAY = 86_400;
  const now = () => Math.floor(Date.now() / 1000);

  it("空闲时长：缩短后，闲置超过新时长的会话立即失效；仍在时长内的有效", async () => {
    await saveSettings(admin.cookie, "security", { ...DEFAULTS.security, session_idle_sec: 7200 });
    const idle = await createSessionCookie(admin.id, { last_seen_at: now() - 7300, expires_at: now() + DAY });
    expect((await api("/api/auth/session", { cookie: idle.cookie })).status).toBe(401);
    const fresh = await createSessionCookie(admin.id, { last_seen_at: now() - 3600, expires_at: now() + DAY });
    expect((await api("/api/auth/session", { cookie: fresh.cookie })).status).toBe(200);
  });

  it("空闲时长：延长后，原本按默认 7 天会过期的会话继续有效", async () => {
    const old = await createSessionCookie(admin.id, { created_at: now() - 8 * DAY, last_seen_at: now() - 8 * DAY, expires_at: now() + DAY });
    expect((await api("/api/auth/session", { cookie: old.cookie })).status).toBe(401);
    const old2 = await createSessionCookie(admin.id, { created_at: now() - 8 * DAY, last_seen_at: now() - 8 * DAY, expires_at: now() + DAY });
    await saveSettings(admin.cookie, "security", { ...DEFAULTS.security, session_idle_sec: 20 * DAY });
    expect((await api("/api/auth/session", { cookie: old2.cookie })).status).toBe(200);
  });

  it("绝对时长：缩短后立即作用于已有会话；新建会话的 Cookie 与过期时间按新时长", async () => {
    await saveSettings(admin.cookie, "security", { ...DEFAULTS.security, session_idle_sec: 3600, session_absolute_sec: 7200 });
    const aged = await createSessionCookie(admin.id, { created_at: now() - 7300, expires_at: now() + 20 * DAY });
    expect((await api("/api/auth/session", { cookie: aged.cookie })).status).toBe(401);

    const res = await api("/api/auth/login", { json: { username: "root", password: TEST_PASSWORD } });
    expect(res.status).toBe(200);
    expect(sidSetCookie(res)).toMatch(/Max-Age=7200/);
    const session = await api("/api/auth/session", { cookie: sidSetCookie(res)?.split(";")[0] ?? "" });
    const { expires_at } = (await session.json()) as { expires_at: number };
    expect(Math.abs(expires_at - (now() + 7200))).toBeLessThanOrEqual(5);
  });

  it("cron 清理用设置里的时长：空闲与绝对都按设置删除", async () => {
    await saveSettings(admin.cookie, "security", { ...DEFAULTS.security, session_idle_sec: 7200, session_absolute_sec: 14_400 });
    await createSessionCookie(admin.id, { last_seen_at: now() - 7300, expires_at: now() + DAY });
    await createSessionCookie(admin.id, { created_at: now() - 14_500, last_seen_at: now(), expires_at: now() + DAY });
    await createSessionCookie(admin.id, { created_at: now() - 100, last_seen_at: now() - 100, expires_at: now() + DAY });
    const before = await sessionCount();
    const processed = await runDailyCleanup(env);
    expect(processed.sessions_deleted).toBe(2);
    expect(await sessionCount()).toBe(before - 2);
  });
});

describe("管理员强制两步验证（security.admin_require_2fa）", () => {
  let secondAdmin: { id: number; cookie: string };

  beforeEach(async () => {
    secondAdmin = await adminSession("root2");
  });

  it("没有任何管理员能满足时拒绝开启（防止把所有管理员锁在外面）", async () => {
    const res = await putSettings(admin.cookie, "security", { ...DEFAULTS.security, admin_require_2fa: true });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("admin_2fa_lockout");
  });

  it("开启后：未启用 TOTP 的管理员访问 /api/admin/* 403 admin_2fa_required；/api/me 与 session 仍可用并带出状态", async () => {
    await enableTotp(admin.cookie);
    await saveSettings(admin.cookie, "security", { ...DEFAULTS.security, admin_require_2fa: true });

    const blocked = await api("/api/admin/users", { cookie: secondAdmin.cookie });
    expect(blocked.status).toBe(403);
    expect(await errorCode(blocked)).toBe("admin_2fa_required");
    expect((await api("/api/me", { cookie: secondAdmin.cookie })).status).toBe(200);
    const session = await api("/api/auth/session", { cookie: secondAdmin.cookie });
    expect(((await session.json()) as { admin_2fa_required: boolean }).admin_2fa_required).toBe(true);

    // 已启用 TOTP 的管理员不受影响
    expect((await api("/api/admin/users", { cookie: admin.cookie })).status).toBe(200);
    expect(((await (await api("/api/auth/session", { cookie: admin.cookie })).json()) as { admin_2fa_required: boolean }).admin_2fa_required).toBe(false);

    // 去账号安全页启用 TOTP 后，同一会话立即放行
    await enableTotp(secondAdmin.cookie);
    expect((await api("/api/admin/users", { cookie: secondAdmin.cookie })).status).toBe(200);
  });

  it("通行密钥登录的会话豁免；普通用户不受影响，session 里 admin_2fa_required 为 false", async () => {
    await enableTotp(admin.cookie);
    await saveSettings(admin.cookie, "security", { ...DEFAULTS.security, admin_require_2fa: true });

    const passkeySession = await createSessionCookie(secondAdmin.id);
    await env.APP_DB.prepare("UPDATE sessions SET auth_methods = 'passkey' WHERE id_hash = ?").bind(passkeySession.idHash).run();
    expect((await api("/api/admin/users", { cookie: passkeySession.cookie })).status).toBe(200);

    const user = await createUser({ username: "bob" });
    const userCookie = (await createSessionCookie(user)).cookie;
    expect((await api("/api/me", { cookie: userCookie })).status).toBe(200);
    expect(((await (await api("/api/auth/session", { cookie: userCookie })).json()) as { admin_2fa_required: boolean }).admin_2fa_required).toBe(false);
  });

  it("只有通行密钥满足条件的管理员：关闭通行密钥登录会被拒绝", async () => {
    await env.APP_DB
      .prepare("INSERT INTO user_passkeys (user_id, name, credential_id, public_key, created_at) VALUES (?, 'k', 'cred', 'pk', 0)")
      .bind(admin.id)
      .run();
    await saveSettings(admin.cookie, "security", { ...DEFAULTS.security, admin_require_2fa: true });
    // 开启后，管理员自己的密码会话也被挡住（没有 TOTP）；换成通行密钥会话继续操作
    expect((await api("/api/admin/users", { cookie: admin.cookie })).status).toBe(403);
    const passkeySession = await createSessionCookie(admin.id);
    await env.APP_DB.prepare("UPDATE sessions SET auth_methods = 'passkey' WHERE id_hash = ?").bind(passkeySession.idHash).run();
    const res = await putSettings(passkeySession.cookie, "auth", { ...DEFAULTS.auth, login_methods: ["password"] });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("admin_2fa_lockout");
  });
});
