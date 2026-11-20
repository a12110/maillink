import { env } from "cloudflare:workers";
import type { MeResponse, TotpSetupResponse } from "@maillink/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MFA_USER_FAILURE_MAX, MFA_USER_LOCK_SEC, PENDING_MFA_MAX_ATTEMPTS, RECENT_AUTH_SEC } from "../src/constants";
import { enableTotpWithRecoveryCodes } from "../src/db/totp";
import { TEST_PASSWORD, api, auditRows, createSessionCookie, createUser, login, resetApp, sidSetCookie } from "./helpers";
import type { ErrorBody } from "./security-helpers";
import { codeAt, cookieFrom, enableTotp, joinCookies, passwordStep } from "./security-helpers";

const FROZEN_SEC = 1_800_000_015;

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as ErrorBody).error.code;
}

async function startSetup(cookie: string): Promise<{ secret: string; setupCookie: string }> {
  const setup = await api("/api/me/totp/setup", { method: "POST", cookie });
  return { secret: ((await setup.json()) as TotpSetupResponse).secret, setupCookie: cookieFrom(setup, "totp_setup") ?? "" };
}

async function passwordlessSession(username: string, ageSec: number): Promise<{ id: number; cookie: string }> {
  const id = await createUser({ username });
  await env.APP_DB.prepare("UPDATE users SET password_hash = NULL WHERE id = ?").bind(id).run();
  const created = Math.floor(Date.now() / 1000) - ageSec;
  return { id, cookie: (await createSessionCookie(id, { created_at: created, last_seen_at: created })).cookie };
}

beforeEach(async () => {
  await resetApp();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FROZEN_SEC * 1000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("必修 1：启用 2FA 与添加通行密钥前再确认身份", () => {
  it("启用 2FA：有密码的账号缺密码 400 reauth_required，密码错 400 reauth_failed 并写审计", async () => {
    await createUser({ username: "alice" });
    const cookie = await login("alice");
    const { secret, setupCookie } = await startSetup(cookie);
    const both = joinCookies(cookie, setupCookie);
    const missing = await api("/api/me/totp/enable", { json: { code: await codeAt(secret) }, cookie: both });
    expect(await errorCode(missing)).toBe("reauth_required");
    const wrong = await api("/api/me/totp/enable", { json: { code: await codeAt(secret), password: "wrong-password!" }, cookie: both });
    expect(await errorCode(wrong)).toBe("reauth_failed");
    expect(JSON.parse((await auditRows("auth.reauth_failed"))[0]?.detail ?? "{}")).toEqual({ method: "password", purpose: "totp_enable" });
    expect((await api("/api/me", { cookie }).then((res) => res.json()) as MeResponse).totp_enabled).toBe(false);
  });

  it(`启用 2FA：没有密码的账号要求会话创建不超过 ${RECENT_AUTH_SEC} 秒`, async () => {
    const old = await passwordlessSession("oauth-old", RECENT_AUTH_SEC + 1);
    const stale = await startSetup(old.cookie);
    const denied = await api("/api/me/totp/enable", { json: { code: await codeAt(stale.secret) }, cookie: joinCookies(old.cookie, stale.setupCookie) });
    expect(await errorCode(denied)).toBe("reauth_required");

    const fresh = await passwordlessSession("oauth-new", 30);
    await enableTotp(fresh.cookie, null);
  });

  it("添加通行密钥：缺密码 400、密码错 400；TOTP 可代替密码；无密码账号看会话新旧；全站关掉通行密钥 403", async () => {
    await createUser({ username: "alice" });
    const cookie = await login("alice");
    expect(await errorCode(await api("/api/me/passkeys/options", { json: {}, cookie }))).toBe("reauth_required");
    expect(await errorCode(await api("/api/me/passkeys/options", { json: { password: "wrong-password!" }, cookie }))).toBe("reauth_failed");
    const { secret } = await enableTotp(cookie);
    expect((await api("/api/me/passkeys/options", { json: { code: await codeAt(secret, 1) }, cookie })).status).toBe(200);

    const old = await passwordlessSession("oauth-old", RECENT_AUTH_SEC + 1);
    expect(await errorCode(await api("/api/me/passkeys/options", { json: {}, cookie: old.cookie }))).toBe("reauth_required");
    const fresh = await passwordlessSession("oauth-new", 30);
    expect((await api("/api/me/passkeys/options", { json: {}, cookie: fresh.cookie })).status).toBe(200);

    await env.APP_DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('auth.login_methods', '[\"password\",\"oauth\"]', 0)").run();
    expect((await api("/api/me/passkeys/options", { json: {}, cookie: fresh.cookie })).status).toBe(403);
  });
});

describe("一并修 4：按用户的第二因素失败上限", () => {
  it(`跨多个 pending_auth 累计 ${MFA_USER_FAILURE_MAX} 次失败即锁定，锁定期间正确码也 429；到期后可用并清零`, async () => {
    const id = await createUser({ username: "alice" });
    const { secret } = await enableTotp(await login("alice"));
    let pending = "";
    for (let attempt = 0; attempt < MFA_USER_FAILURE_MAX; attempt += 1) {
      if (attempt % (PENDING_MFA_MAX_ATTEMPTS - 1) === 0) pending = await passwordStep("alice", TEST_PASSWORD);
      expect((await api("/api/auth/mfa/totp", { json: { code: "000000" }, cookie: pending })).status).toBe(401);
    }
    const locked = await api("/api/auth/mfa/totp", { json: { code: await codeAt(secret, 1) }, cookie: await passwordStep("alice", TEST_PASSWORD) });
    expect(locked.status).toBe(429);
    expect(await errorCode(locked)).toBe("mfa_locked");
    expect(await auditRows("auth.mfa_locked")).toHaveLength(1);

    vi.setSystemTime((FROZEN_SEC + MFA_USER_LOCK_SEC + 1) * 1000);
    const ok = await api("/api/auth/mfa/totp", { json: { code: await codeAt(secret) }, cookie: await passwordStep("alice", TEST_PASSWORD) });
    expect(ok.status).toBe(200);
    const row = await env.APP_DB.prepare("SELECT mfa_fail_count, mfa_locked_until FROM users WHERE id = ?").bind(id).first();
    expect(row).toEqual({ mfa_fail_count: 0, mfa_locked_until: null });
  });

  it("再确认（DELETE /api/me/totp、POST /api/me/recovery-codes）的密码与 TOTP 失败计入同一上限；成功清零", async () => {
    await createUser({ username: "alice" });
    const cookie = await login("alice");
    await enableTotp(cookie);
    for (let attempt = 0; attempt < MFA_USER_FAILURE_MAX - 1; attempt += 1) {
      const path = attempt % 2 === 0 ? "/api/me/totp" : "/api/me/recovery-codes";
      const json = attempt % 3 === 0 ? { code: "000000" } : { password: "wrong-password!" };
      expect((await api(path, { method: attempt % 2 === 0 ? "DELETE" : "POST", json, cookie })).status).toBe(400);
    }
    // 第 10 次之前一次成功会清零，再错 9 次也不锁
    expect((await api("/api/me/recovery-codes", { json: { password: TEST_PASSWORD }, cookie })).status).toBe(200);
    for (let attempt = 0; attempt < MFA_USER_FAILURE_MAX - 1; attempt += 1) {
      expect((await api("/api/me/totp", { method: "DELETE", json: { password: "wrong-password!" }, cookie })).status).toBe(400);
    }
    expect((await api("/api/me/totp", { method: "DELETE", json: { password: "wrong-password!" }, cookie })).status).toBe(400);
    const locked = await api("/api/me/totp", { method: "DELETE", json: { password: TEST_PASSWORD }, cookie });
    expect(locked.status).toBe(429);
    expect(await errorCode(locked)).toBe("mfa_locked");
    expect((await auditRows("auth.reauth_failed")).length).toBe(2 * MFA_USER_FAILURE_MAX - 1);
  });
});

describe("一并修 9 / 10 / 12：并发与原子性", () => {
  it("同一 TOTP 码并发提交到两个 pending_auth：只有一个成功", async () => {
    await createUser({ username: "alice" });
    const { secret } = await enableTotp(await login("alice"));
    const pendings = [await passwordStep("alice", TEST_PASSWORD), await passwordStep("alice", TEST_PASSWORD)];
    const code = await codeAt(secret, 1);
    const results = await Promise.all(pendings.map((cookie) => api("/api/auth/mfa/totp", { json: { code }, cookie })));
    expect(results.map((res) => res.status).sort()).toEqual([200, 401]);
  });

  it("同一恢复码并发提交到两个 pending_auth：只有一个成功，只消耗一次", async () => {
    await createUser({ username: "alice" });
    const cookie = await login("alice");
    const { recoveryCodes } = await enableTotp(cookie);
    const pendings = [await passwordStep("alice", TEST_PASSWORD), await passwordStep("alice", TEST_PASSWORD)];
    const results = await Promise.all(pendings.map((pending) => api("/api/auth/mfa/recovery", { json: { code: recoveryCodes[0] }, cookie: pending })));
    expect(results.map((res) => res.status).sort()).toEqual([200, 401]);
    expect(((await (await api("/api/me", { cookie })).json()) as MeResponse).recovery_codes_remaining).toBe(9);
  });

  it("同一 pending_auth 并发提交两个不同的正确恢复码：只发一个会话，只消耗一个恢复码", async () => {
    await createUser({ username: "alice" });
    const cookie = await login("alice");
    const { recoveryCodes } = await enableTotp(cookie);
    const pending = await passwordStep("alice", TEST_PASSWORD);
    const results = await Promise.all(
      [recoveryCodes[0], recoveryCodes[1]].map((code) => api("/api/auth/mfa/recovery", { json: { code }, cookie: pending })),
    );
    expect(results.filter((res) => sidSetCookie(res) !== undefined)).toHaveLength(1);
    expect(((await (await api("/api/me", { cookie })).json()) as MeResponse).recovery_codes_remaining).toBe(9);
  });

  it(`同一 pending_auth 并发提交多个错码：计入的尝试不超过 ${PENDING_MFA_MAX_ATTEMPTS} 次`, async () => {
    await createUser({ username: "alice" });
    await enableTotp(await login("alice"));
    const pending = await passwordStep("alice", TEST_PASSWORD);
    const results = await Promise.all(Array.from({ length: 8 }, () => api("/api/auth/mfa/totp", { json: { code: "000000" }, cookie: pending })));
    const codes = await Promise.all(results.map(errorCode));
    expect(codes.filter((code) => code === "invalid_mfa_code").length).toBeLessThanOrEqual(PENDING_MFA_MAX_ATTEMPTS - 1);
    const row = await env.APP_DB.prepare("SELECT MAX(attempts) AS n FROM auth_flow_tokens").first<{ n: number }>();
    expect(row?.n).toBeLessThanOrEqual(PENDING_MFA_MAX_ATTEMPTS);
  });

  it("用过下一时间步的码之后，当前时间步的码被拒（重放保护按时间步单调）", async () => {
    await createUser({ username: "alice" });
    const cookie = await login("alice");
    const { secret, setupCookie } = await startSetup(cookie);
    // 启用时用下一步的码，当前步还没用过
    const enable = await api("/api/me/totp/enable", { json: { code: await codeAt(secret, 1), password: TEST_PASSWORD }, cookie: joinCookies(cookie, setupCookie) });
    expect(enable.status).toBe(200);
    const current = await api("/api/auth/mfa/totp", { json: { code: await codeAt(secret, 0) }, cookie: await passwordStep("alice", TEST_PASSWORD) });
    expect(current.status).toBe(401);
    expect((await auditRows("auth.mfa_failed")).map((row) => JSON.parse(row.detail ?? "{}").reason)).toContain("replayed");
  });

  it("启用 2FA 与写恢复码同一事务：已启用时整批不生效，原恢复码保持不变", async () => {
    const id = await createUser({ username: "alice" });
    expect(await enableTotpWithRecoveryCodes(env.APP_DB, id, { secretEnc: "v1.a.b", usedStep: 1, recoveryHashes: ["h1", "h2"] }, 1)).toBe(true);
    expect(await enableTotpWithRecoveryCodes(env.APP_DB, id, { secretEnc: "v1.c.d", usedStep: 2, recoveryHashes: ["h3"] }, 2)).toBe(false);
    const { results } = await env.APP_DB.prepare("SELECT code_hash FROM user_recovery_codes WHERE user_id = ? ORDER BY id").bind(id).all();
    expect(results).toEqual([{ code_hash: "h1" }, { code_hash: "h2" }]);
  });
});
