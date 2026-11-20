import { env } from "cloudflare:workers";
import type { MeResponse, TotpSetupResponse } from "@maillink/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PENDING_MFA_MAX_ATTEMPTS, PENDING_MFA_SEC } from "../src/constants";
import { TEST_PASSWORD, api, auditRows, createSessionCookie, createUser, login, resetApp, sessionCount, sidSetCookie } from "./helpers";
import type { ErrorBody } from "./security-helpers";
import { codeAt, cookieCleared, cookieFrom, enableTotp, joinCookies, passwordStep, userTotpColumns } from "./security-helpers";

// 时间冻结在某个时间步的正中间，前后一步的码都确定可用
const FROZEN_SEC = 1_800_000_015;

async function sessionMethods(cookie: string): Promise<string[]> {
  const res = await api("/api/auth/session", { cookie });
  return ((await res.json()) as { auth_methods: string[] }).auth_methods;
}

async function submitTotp(pending: string, code: string): Promise<Response> {
  return api("/api/auth/mfa/totp", { json: { code }, cookie: pending });
}

describe("两步验证：启用与关闭", () => {
  beforeEach(resetApp);

  it("setup 不落库；enable 错码 400；正确码启用、只存恢复码哈希、其他会话失效、写审计", async () => {
    const id = await createUser({ username: "alice" });
    const cookie = await login("alice");
    const other = await createSessionCookie(id);

    const setup = await api("/api/me/totp/setup", { method: "POST", cookie });
    expect(setup.status).toBe(200);
    const body = (await setup.json()) as TotpSetupResponse;
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(body.otpauth_uri).toContain(`secret=${body.secret}`);
    const setupLine = setup.headers.getSetCookie().find((line) => line.startsWith("totp_setup=")) ?? "";
    expect(setupLine).toMatch(/HttpOnly/);
    expect(setupLine).toMatch(/Path=\/api\/me\/totp/);
    expect(setupLine).not.toContain(body.secret);
    expect((await userTotpColumns(id))?.totp_secret_enc).toBeNull();

    const setupCookie = cookieFrom(setup, "totp_setup");
    const wrong = await api("/api/me/totp/enable", { json: { code: "000000", password: TEST_PASSWORD }, cookie: joinCookies(cookie, setupCookie) });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as ErrorBody).error.code).toBe("invalid_totp_code");

    const ok = await api("/api/me/totp/enable", { json: { code: await codeAt(body.secret), password: TEST_PASSWORD }, cookie: joinCookies(cookie, setupCookie) });
    expect(ok.status).toBe(200);
    const codes = ((await ok.json()) as { recovery_codes: string[] }).recovery_codes;
    expect(codes).toHaveLength(10);
    expect(cookieCleared(ok, "totp_setup")).toBe(true);

    const columns = await userTotpColumns(id);
    expect(columns?.totp_secret_enc).toMatch(/^v1\./);
    expect(columns?.totp_secret_enc).not.toContain(body.secret);
    const stored = await env.APP_DB.prepare("SELECT code_hash FROM user_recovery_codes WHERE user_id = ?").bind(id).all<{ code_hash: string }>();
    expect(stored.results).toHaveLength(10);
    for (const code of codes) expect(JSON.stringify(stored.results)).not.toContain(code.replace("-", ""));

    expect((await api("/api/auth/session", { cookie: other.cookie })).status).toBe(401);
    expect((await api("/api/auth/session", { cookie })).status).toBe(200);
    const me = (await (await api("/api/me", { cookie })).json()) as MeResponse;
    expect(me).toMatchObject({ totp_enabled: true, recovery_codes_remaining: 10 });
    expect(await auditRows("auth.totp_enable")).toHaveLength(1);

    const again = await api("/api/me/totp/setup", { method: "POST", cookie });
    expect(again.status).toBe(409);
  });

  it("enable 需要本人的、未过期的 setup Cookie", async () => {
    await createUser({ username: "alice" });
    await createUser({ username: "bob" });
    const alice = await login("alice");
    const bob = await login("bob");
    const setup = await api("/api/me/totp/setup", { method: "POST", cookie: alice });
    const { secret } = (await setup.json()) as TotpSetupResponse;
    const code = await codeAt(secret);

    const missing = await api("/api/me/totp/enable", { json: { code, password: TEST_PASSWORD }, cookie: alice });
    expect(((await missing.json()) as ErrorBody).error.code).toBe("totp_setup_expired");
    const stolen = await api("/api/me/totp/enable", { json: { code, password: TEST_PASSWORD }, cookie: joinCookies(bob, cookieFrom(setup, "totp_setup")) });
    expect(stolen.status).toBe(400);
    expect(((await stolen.json()) as ErrorBody).error.code).toBe("totp_setup_expired");
  });

  it("关闭需要当前密码或 TOTP；成功后清密钥与恢复码、其他会话失效", async () => {
    const id = await createUser({ username: "alice" });
    const cookie = await login("alice");
    await enableTotp(cookie);
    const other = await createSessionCookie(id);

    const noBody = await api("/api/me/totp", { method: "DELETE", json: {}, cookie });
    expect(noBody.status).toBe(400);
    const badPassword = await api("/api/me/totp", { method: "DELETE", json: { password: "nope-nope-nope" }, cookie });
    expect(((await badPassword.json()) as ErrorBody).error.code).toBe("reauth_failed");

    const res = await api("/api/me/totp", { method: "DELETE", json: { password: TEST_PASSWORD }, cookie });
    expect(res.status).toBe(200);
    expect(await userTotpColumns(id)).toEqual({ totp_secret_enc: null, totp_enabled_at: null, totp_last_step: null });
    const left = await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM user_recovery_codes WHERE user_id = ?").bind(id).first<{ n: number }>();
    expect(left?.n).toBe(0);
    expect((await api("/api/auth/session", { cookie: other.cookie })).status).toBe(401);
    expect(await auditRows("auth.totp_disable")).toHaveLength(1);
    expect((await api("/api/me/totp", { method: "DELETE", json: { password: TEST_PASSWORD }, cookie })).status).toBe(409);
  });

  it("重新生成恢复码：需要再确认，旧码全部作废", async () => {
    await createUser({ username: "alice" });
    const cookie = await login("alice");
    const { recoveryCodes } = await enableTotp(cookie);
    expect((await api("/api/me/recovery-codes", { json: { password: "wrong-password!" }, cookie })).status).toBe(400);

    const res = await api("/api/me/recovery-codes", { json: { password: TEST_PASSWORD }, cookie });
    expect(res.status).toBe(200);
    const fresh = ((await res.json()) as { recovery_codes: string[] }).recovery_codes;
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toContain(recoveryCodes[0]);

    const pendingOld = await passwordStep("alice", TEST_PASSWORD);
    const old = await api("/api/auth/mfa/recovery", { json: { code: recoveryCodes[0] }, cookie: pendingOld });
    expect(old.status).toBe(401);
    const freshOk = await api("/api/auth/mfa/recovery", { json: { code: fresh[0] }, cookie: pendingOld });
    expect(freshOk.status).toBe(200);
  });
});

describe("两步验证：登录", () => {
  beforeEach(async () => {
    await resetApp();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FROZEN_SEC * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("密码通过后不发会话，返回 mfa_required 与 pending_auth；正确 TOTP 换取会话", async () => {
    await createUser({ username: "alice" });
    const { secret } = await enableTotp(await login("alice"));

    const res = await api("/api/auth/login", { json: { username: "alice", password: TEST_PASSWORD } });
    expect(await res.json()).toEqual({ status: "mfa_required", methods: ["totp", "recovery"], expires_at: FROZEN_SEC + PENDING_MFA_SEC });
    expect(sidSetCookie(res)).toBeUndefined();
    const line = res.headers.getSetCookie().find((item) => item.startsWith("pending_auth=")) ?? "";
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/SameSite=Strict/i);
    expect(line).toMatch(/Path=\/api\/auth\/mfa/);
    expect(line).toContain(`Max-Age=${PENDING_MFA_SEC}`);

    // 启用时用掉的是当前时间步，换下一步的码登录
    const ok = await submitTotp(cookieFrom(res, "pending_auth") ?? "", await codeAt(secret, 1));
    expect(ok.status).toBe(200);
    expect(cookieCleared(ok, "pending_auth")).toBe(true);
    const sid = sidSetCookie(ok)?.split(";")[0] ?? "";
    expect(await sessionMethods(sid)).toEqual(["password", "totp"]);
    const success = await auditRows("auth.login");
    expect(success.at(-1)?.detail).toContain("password,totp");
  });

  it("同一时间步的码只能用一次；更早的时间步也不行；前后各一步内可用", async () => {
    const id = await createUser({ username: "alice" });
    const { secret } = await enableTotp(await login("alice"));

    // 启用时用过当前步，再提交当前步与前一步都是重放
    for (const offset of [0, -1]) {
      const res = await submitTotp(await passwordStep("alice", TEST_PASSWORD), await codeAt(secret, offset));
      expect(res.status, String(offset)).toBe(401);
      expect(((await res.json()) as ErrorBody).error.code).toBe("invalid_mfa_code");
    }
    const far = await submitTotp(await passwordStep("alice", TEST_PASSWORD), await codeAt(secret, 2));
    expect(far.status).toBe(401);

    const next = await codeAt(secret, 1);
    expect((await submitTotp(await passwordStep("alice", TEST_PASSWORD), next)).status).toBe(200);
    const replay = await submitTotp(await passwordStep("alice", TEST_PASSWORD), next);
    expect(replay.status).toBe(401);
    expect((await userTotpColumns(id))?.totp_last_step).toBe(Math.floor(FROZEN_SEC / 30) + 1);
    const failures = await auditRows("auth.mfa_failed");
    expect(failures.map((row) => JSON.parse(row.detail ?? "{}").reason)).toContain("replayed");
  });

  it("恢复码只能用一次", async () => {
    await createUser({ username: "alice" });
    const { recoveryCodes } = await enableTotp(await login("alice"));
    const code = recoveryCodes[3] ?? "";

    const ok = await api("/api/auth/mfa/recovery", { json: { code: code.toLowerCase() }, cookie: await passwordStep("alice", TEST_PASSWORD) });
    expect(ok.status).toBe(200);
    const sid = sidSetCookie(ok)?.split(";")[0] ?? "";
    expect(await sessionMethods(sid)).toEqual(["password", "recovery"]);
    const me = (await (await api("/api/me", { cookie: sid })).json()) as MeResponse;
    expect(me.recovery_codes_remaining).toBe(9);

    const again = await api("/api/auth/mfa/recovery", { json: { code }, cookie: await passwordStep("alice", TEST_PASSWORD) });
    expect(again.status).toBe(401);
    expect(((await again.json()) as ErrorBody).error.code).toBe("invalid_mfa_code");
  });

  it("pending_auth 过期作废", async () => {
    await createUser({ username: "alice" });
    const { secret } = await enableTotp(await login("alice"));
    const pending = await passwordStep("alice", TEST_PASSWORD);

    vi.setSystemTime((FROZEN_SEC + PENDING_MFA_SEC + 1) * 1000);
    const res = await submitTotp(pending, await codeAt(secret));
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorBody).error.code).toBe("mfa_pending_invalid");
    expect(cookieCleared(res, "pending_auth")).toBe(true);
  });

  it("pending_auth 成功一次后不能再用；伪造或缺失也拒绝", async () => {
    await createUser({ username: "alice" });
    const { secret, recoveryCodes } = await enableTotp(await login("alice"));
    const pending = await passwordStep("alice", TEST_PASSWORD);

    expect((await submitTotp(pending, await codeAt(secret, 1))).status).toBe(200);
    const reuse = await api("/api/auth/mfa/recovery", { json: { code: recoveryCodes[0] }, cookie: pending });
    expect(reuse.status).toBe(401);
    expect(((await reuse.json()) as ErrorBody).error.code).toBe("mfa_pending_invalid");

    expect((await submitTotp("", "123456")).status).toBe(401);
    const forged = `${pending.slice(0, -2)}AA`;
    expect((await submitTotp(forged, "123456")).status).toBe(401);
  });

  it(`错误次数上限：${PENDING_MFA_MAX_ATTEMPTS} 次后作废，正确码也不再接受`, async () => {
    await createUser({ username: "alice" });
    const { secret } = await enableTotp(await login("alice"));
    const pending = await passwordStep("alice", TEST_PASSWORD);

    for (let attempt = 1; attempt < PENDING_MFA_MAX_ATTEMPTS; attempt += 1) {
      const res = await submitTotp(pending, "000000");
      expect(((await res.json()) as ErrorBody).error.code).toBe("invalid_mfa_code");
    }
    const last = await submitTotp(pending, "000000");
    expect(((await last.json()) as ErrorBody).error.code).toBe("mfa_pending_invalid");
    const late = await submitTotp(pending, await codeAt(secret, 1));
    expect(late.status).toBe(401);
    expect(((await late.json()) as ErrorBody).error.code).toBe("mfa_pending_invalid");
    expect(await sessionCount()).toBe(1);
  });

  it("等待二次验证期间账号被禁用：拒绝", async () => {
    const id = await createUser({ username: "alice" });
    const { secret } = await enableTotp(await login("alice"));
    const pending = await passwordStep("alice", TEST_PASSWORD);
    await env.APP_DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind(id).run();
    expect((await submitTotp(pending, await codeAt(secret, 1))).status).toBe(401);
  });
});

describe("批量注销其他会话", () => {
  beforeEach(resetApp);

  it("scope=others 只保留当前会话；缺 scope 400", async () => {
    const id = await createUser({ username: "alice" });
    const cookie = await login("alice");
    await createSessionCookie(id);
    await createSessionCookie(id);
    const bob = await createUser({ username: "bob" });
    await createSessionCookie(bob);

    expect((await api("/api/me/sessions", { method: "DELETE", cookie })).status).toBe(400);
    const res = await api("/api/me/sessions?scope=others", { method: "DELETE", cookie });
    expect(await res.json()).toEqual({ status: "ok", revoked: 2 });
    expect(await sessionCount(id)).toBe(1);
    expect(await sessionCount(bob)).toBe(1);
    expect((await api("/api/auth/session", { cookie })).status).toBe(200);
    expect(await auditRows("auth.sessions_revoke_others")).toHaveLength(1);
  });
});
