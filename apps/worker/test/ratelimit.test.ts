import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { healthResponseSchema } from "@maillink/shared";
import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_PERIOD_SEC, RATE_LIMIT_PURPOSES } from "../src/constants";
import type { AppEnv } from "../src/env";
import { onError } from "../src/middleware/error";
import { enforceRateLimit, rateLimitKey, requestIp } from "../src/ratelimit";
import { adminSession, api, createUser, resetApp } from "./helpers";

type ErrorBody = { error: { code: string } };

const DENY_ALL: RateLimit = { limit: async () => ({ success: false }) };

/** 记录收到的 key 的替身 */
function recordingLimiter(): { limiter: RateLimit; keys: string[] } {
  const keys: string[] = [];
  return { keys, limiter: { limit: async ({ key }) => (keys.push(key), { success: true }) } };
}

let ipCounter = 0;
/** 每个测试用不同的 IP，避免真实 binding 的计数互相干扰 */
function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

const login = (username: string, ip: string, bindings: Parameters<typeof api>[1] = {}) =>
  api("/api/auth/login", {
    json: { username, password: "wrong-password-xyz" },
    headers: { "CF-Connecting-IP": ip },
    ...bindings,
  });

const REAL = { bindings: { RATE_LIMITER: env.RATE_LIMITER } } as const;

describe("限流：真实 RATE_LIMITER binding（wrangler.jsonc 的 ratelimits）", () => {
  beforeEach(resetApp);

  it("本地与 vitest 里 binding 可用，且 constants 的阈值与 wrangler.jsonc 一致", async () => {
    expect(env.RATE_LIMITER).toBeDefined();
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS + 1; i += 1) {
      statuses.push((await login(`user-${i}`, ip, REAL)).status);
    }
    // 前 N 次放行（用户不存在 → 401），第 N+1 次 429
    expect(statuses.slice(0, RATE_LIMIT_MAX_REQUESTS).every((status) => status === 401)).toBe(true);
    expect(statuses[RATE_LIMIT_MAX_REQUESTS]).toBe(429);
  });

  it("按 IP 超限：429 rate_limited，带 Retry-After；其他 IP 不受影响", async () => {
    const ip = freshIp();
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i += 1) await login(`other-${i}`, ip, REAL);
    const limited = await login("anyone", ip, REAL);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe(String(RATE_LIMIT_PERIOD_SEC));
    expect(((await limited.json()) as ErrorBody).error.code).toBe("rate_limited");

    expect((await login("anyone", freshIp(), REAL)).status).toBe(401);
  });

  it("按用户名超限：换 IP 也被拦；用户名不区分大小写", async () => {
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i += 1) {
      const username = i % 2 === 0 ? "Victim" : "victim";
      expect((await login(username, freshIp(), REAL)).status).toBe(401);
    }
    const res = await login("VICTIM", freshIp(), REAL);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe(String(RATE_LIMIT_PERIOD_SEC));
  });

  it("读取请求体用的是 clone：登录 handler 仍能读到 body（合法登录成功）", async () => {
    await createUser({ username: "alice" });
    const res = await api("/api/auth/login", {
      json: { username: "alice", password: "correct-horse-battery" },
      headers: { "CF-Connecting-IP": freshIp() },
      ...REAL,
    });
    expect(res.status).toBe(200);
  });
});

describe("限流：key 与挂载路径（测试内替身）", () => {
  beforeEach(resetApp);

  it("登录同时按 IP 与小写用户名计数", async () => {
    const { limiter, keys } = recordingLimiter();
    await login("MixedCase", "203.0.113.9", { bindings: { RATE_LIMITER: limiter } });
    expect(keys).toEqual(["login:ip:203.0.113.9", "login:user:mixedcase"]);
  });

  it("请求体不是 JSON：只按 IP 计数，handler 照常返回 400", async () => {
    const { limiter, keys } = recordingLimiter();
    const res = await api("/api/auth/login", {
      method: "POST",
      headers: { "CF-Connecting-IP": "203.0.113.10", "Content-Type": "application/json" },
      bindings: { RATE_LIMITER: limiter },
    });
    expect(res.status).toBe(400);
    expect(keys).toEqual(["login:ip:203.0.113.10"]);
  });

  it("没有 CF-Connecting-IP 时归入共用的 no-ip 桶", async () => {
    const { limiter, keys } = recordingLimiter();
    await api("/api/setup", { json: {}, bindings: { RATE_LIMITER: limiter } });
    expect(keys).toEqual(["setup:ip:no-ip"]);
  });

  it.each([
    ["POST", "/api/setup"],
    ["POST", "/api/auth/login"],
    ["POST", "/api/auth/mfa/totp"],
    ["POST", "/api/auth/mfa/recovery"],
    ["POST", "/api/auth/passkey/options"],
    ["POST", "/api/auth/passkey/verify"],
    ["GET", "/api/auth/oauth/github/start"],
    ["GET", "/api/auth/oauth/github/callback"],
  ])("%s %s：超限时 429，先于任何业务处理", async (method, path) => {
    const res = await api(path, {
      method,
      ...(method === "POST" ? { json: { username: "x", password: "y" } } : {}),
      bindings: { RATE_LIMITER: DENY_ALL },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe(String(RATE_LIMIT_PERIOD_SEC));
  });

  it.each([
    ["POST", "/api/setup"],
    ["POST", "/api/auth/login"],
    ["POST", "/api/auth/mfa/totp"],
    ["POST", "/api/auth/passkey/options"],
    ["GET", "/api/auth/oauth/github/start"],
  ])("%s %s：binding 缺失时 503 rate_limiter_not_configured，不放行", async (method, path) => {
    const res = await api(path, {
      method,
      ...(method === "POST" ? { json: { username: "x", password: "y" } } : {}),
      bindings: { RATE_LIMITER: undefined },
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as ErrorBody).error.code).toBe("rate_limiter_not_configured");
  });

  it("不受保护的路径不调用限流", async () => {
    const { limiter, keys } = recordingLimiter();
    await api("/api/setup/status", { bindings: { RATE_LIMITER: limiter } });
    await api("/api/auth/logout", { method: "POST", bindings: { RATE_LIMITER: limiter } });
    expect(keys).toEqual([]);
  });

  it("binding 自身抛错：请求失败（500），不放行", async () => {
    const broken: RateLimit = {
      limit: async () => {
        throw new Error("limiter down (synthetic)");
      },
    };
    const res = await login("alice", freshIp(), { bindings: { RATE_LIMITER: broken } });
    expect(res.status).toBe(500);
  });
});

describe("限流：给取件链接用的 enforceRateLimit", () => {
  const linkApp = new Hono<AppEnv>();
  linkApp.onError(onError);
  linkApp.get("/s/:token", async (c) => {
    await enforceRateLimit(c, RATE_LIMIT_PURPOSES.link, c.req.param("token"), requestIp(c));
    return c.text("ok");
  });

  it("key 为 link:<token_hash>:<ip>；超限 429 + Retry-After；缺 binding 503", async () => {
    const { limiter, keys } = recordingLimiter();
    const headers = { "CF-Connecting-IP": "192.0.2.5" };
    expect((await linkApp.request("/s/abc123", { headers }, { ...env, RATE_LIMITER: limiter })).status).toBe(200);
    expect(keys).toEqual(["link:abc123:192.0.2.5"]);

    const limited = await linkApp.request("/s/abc123", { headers }, { ...env, RATE_LIMITER: DENY_ALL });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe(String(RATE_LIMIT_PERIOD_SEC));

    const missing = await linkApp.request("/s/abc123", { headers }, { ...env, RATE_LIMITER: undefined });
    expect(missing.status).toBe(503);
  });

  it("rateLimitKey 截断超长片段", () => {
    const key = rateLimitKey(RATE_LIMIT_PURPOSES.loginUser, "a".repeat(1000));
    expect(key.length).toBeLessThan(200);
    expect(key.startsWith("login:user:aaa")).toBe(true);
  });
});

describe("health 的 rate_limit 状态", () => {
  it("已配置 / 未配置", async () => {
    await resetApp();
    const { cookie } = await adminSession();
    const configured = healthResponseSchema.parse(await (await api("/api/admin/system/health", { cookie })).json());
    expect(configured.rate_limit).toEqual({ configured: true });
    const missing = healthResponseSchema.parse(
      await (await api("/api/admin/system/health", { cookie, bindings: { RATE_LIMITER: undefined } })).json(),
    );
    expect(missing.rate_limit).toEqual({ configured: false });
  });
});
