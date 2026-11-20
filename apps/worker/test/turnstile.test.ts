import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TURNSTILE_FETCH_MAX_BYTES, TURNSTILE_VERIFY_URL } from "../src/constants";
import type { AppEnv } from "../src/env";
import { notFound, onError } from "../src/middleware/error";
import { enforceTurnstile } from "../src/turnstile/verify";
import { adminSession, api, createUser, resetApp, sessionCount, sidSetCookie, TEST_PASSWORD } from "./helpers";
import { DEFAULTS, TURNSTILE_SECRET, enableTurnstile, errorCode, installTurnstileFetch, saveSettings, setRawSetting } from "./settings-helpers";

const IP = "203.0.113.9";
const NEW_PASSWORD = "a-brand-new-password";

let admin: { id: number; cookie: string };
beforeEach(async () => {
  await resetApp();
  admin = await adminSession();
  await createUser({ username: "alice" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function loginWith(token?: string): Promise<Response> {
  return api("/api/auth/login", {
    json: { username: "alice", password: TEST_PASSWORD, ...(token === undefined ? {} : { turnstile_token: token }) },
    headers: { "CF-Connecting-IP": IP },
  });
}

describe("登录的人机验证（作用范围含 login）", () => {
  it("没有 token：400 turnstile_failed，不调用 Cloudflare，不发会话", async () => {
    await enableTurnstile(admin.cookie, ["login"]);
    const calls = installTurnstileFetch();
    const res = await loginWith();
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("turnstile_failed");
    expect(sidSetCookie(res)).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("token 有效：登录成功；请求发往固定地址，带 secret、response、remoteip（secret 是解密后的原文）", async () => {
    await enableTurnstile(admin.cookie, ["login"]);
    const calls = installTurnstileFetch();
    const res = await loginWith("good");
    expect(res.status).toBe(200);
    expect(sidSetCookie(res)).toBeDefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(TURNSTILE_VERIFY_URL);
    expect(calls[0]?.method).toBe("POST");
    expect(Object.fromEntries(calls[0]?.form ?? [])).toEqual({ secret: TURNSTILE_SECRET, response: "good", remoteip: IP });
  });

  it("token 无效：400 turnstile_failed，不发会话；密码正确也一样", async () => {
    await enableTurnstile(admin.cookie, ["login"]);
    installTurnstileFetch();
    const res = await loginWith("bad");
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("turnstile_failed");
    expect(await sessionCount()).toBe(1); // 只有管理员 helper 建的那个
  });

  it("作用范围不含 login：不要求 token，也不调用 Cloudflare", async () => {
    await enableTurnstile(admin.cookie, ["register"]);
    const calls = installTurnstileFetch();
    expect((await loginWith()).status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it("未启用：不要求，即使库里还留着 secret", async () => {
    await enableTurnstile(admin.cookie, ["login"]);
    await saveSettings(admin.cookie, "turnstile", { enabled: false, site_key: "k", scopes: ["login"] });
    const calls = installTurnstileFetch();
    expect((await loginWith()).status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it("要求校验但系统没配好（启用、范围含 login，却没有 secret）：503 turnstile_not_configured，不放行", async () => {
    await setRawSetting("turnstile.enabled", true);
    await setRawSetting("turnstile.site_key", "k");
    await setRawSetting("turnstile.scopes", ["login"]);
    const calls = installTurnstileFetch();
    const res = await loginWith("good");
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("turnstile_not_configured");
    expect(sidSetCookie(res)).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe("注册的人机验证（作用范围含 register）", () => {
  beforeEach(async () => {
    await saveSettings(admin.cookie, "auth", { ...DEFAULTS.auth, registration_enabled: true });
    await enableTurnstile(admin.cookie, ["register"]);
  });

  function register(token?: string): Promise<Response> {
    return api("/api/auth/register", {
      json: { username: "newbie", password: NEW_PASSWORD, ...(token === undefined ? {} : { turnstile_token: token }) },
      headers: { "CF-Connecting-IP": IP },
    });
  }

  it("通过 201；失败 400；缺 token 400；失败时不建用户", async () => {
    installTurnstileFetch();
    const missing = await register();
    expect(missing.status).toBe(400);
    const bad = await register("bad");
    expect(await errorCode(bad)).toBe("turnstile_failed");
    expect(await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'newbie'").first<{ n: number }>()).toEqual({ n: 0 });
    expect((await register("good")).status).toBe(201);
  });

  it("系统没配好：503 turnstile_not_configured，不建用户", async () => {
    await env.APP_DB.prepare("DELETE FROM settings WHERE key = 'turnstile.secret_enc'").run();
    installTurnstileFetch();
    const res = await register("good");
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("turnstile_not_configured");
    expect(await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'newbie'").first<{ n: number }>()).toEqual({ n: 0 });
  });
});

describe("Cloudflare 校验服务异常：失败关闭，503 turnstile_unavailable", () => {
  beforeEach(async () => {
    await enableTurnstile(admin.cookie, ["login"]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  async function expectUnavailable(): Promise<void> {
    const res = await loginWith("good");
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("turnstile_unavailable");
    expect(sidSetCookie(res)).toBeUndefined();
  }

  it("网络错误", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network down"));
    await expectUnavailable();
  });

  it("超时", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expectUnavailable();
  });

  it("非 2xx、非 JSON、格式不符、响应超过上限", async () => {
    for (const make of [
      () => new Response("oops", { status: 500 }),
      () => new Response("<html>", { status: 200 }),
      () => Response.json({ ok: true }),
      () => new Response("x".repeat(TURNSTILE_FETCH_MAX_BYTES + 1)),
    ]) {
      vi.restoreAllMocks();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      installTurnstileFetch(make);
      await expectUnavailable();
    }
  });

  it("请求设了超时信号与禁止重定向", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ success: true }));
    expect((await loginWith("good")).status).toBe(200);
    const init = spy.mock.calls[0]?.[1];
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("导出给取件页的 enforceTurnstile（forced：链接自己要求校验）", () => {
  const pickup = new Hono<AppEnv>();
  pickup.onError(onError);
  pickup.notFound(notFound);
  pickup.post("/start", async (c) => {
    const body = (await c.req.json()) as { token?: string; forced?: boolean };
    await enforceTurnstile(c, "pickup", body.token, { forced: body.forced === true });
    return c.json({ status: "ok" });
  });

  function start(body: Record<string, unknown>): Promise<Response> {
    return Promise.resolve(
      pickup.request("/start", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }, env),
    );
  }

  it("不强制且系统范围不含 pickup：直接通过", async () => {
    await enableTurnstile(admin.cookie, ["login"]);
    const calls = installTurnstileFetch();
    expect((await start({})).status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it("强制但系统未启用 / 范围不含 pickup / 缺 secret：503 turnstile_not_configured，不放行", async () => {
    installTurnstileFetch();
    const notEnabled = await start({ forced: true, token: "good" });
    expect(notEnabled.status).toBe(503);
    expect(await errorCode(notEnabled)).toBe("turnstile_not_configured");

    await enableTurnstile(admin.cookie, ["login"]);
    expect((await start({ forced: true, token: "good" })).status).toBe(503);

    await enableTurnstile(admin.cookie, ["pickup"]);
    await env.APP_DB.prepare("DELETE FROM settings WHERE key = 'turnstile.secret_enc'").run();
    expect((await start({ forced: true, token: "good" })).status).toBe(503);
  });

  it("强制且已配置：有效 200，无效或缺失 400 turnstile_failed", async () => {
    await enableTurnstile(admin.cookie, ["pickup"]);
    installTurnstileFetch();
    expect((await start({ forced: true, token: "good" })).status).toBe(200);
    expect(await errorCode(await start({ forced: true, token: "bad" }))).toBe("turnstile_failed");
    expect(await errorCode(await start({ forced: true }))).toBe("turnstile_failed");
  });

  it("系统范围含 pickup 时不强制也要校验", async () => {
    await enableTurnstile(admin.cookie, ["pickup"]);
    installTurnstileFetch();
    expect((await start({ token: "bad" })).status).toBe(400);
  });
});
