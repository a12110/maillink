import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { healthResponseSchema } from "@maillink/shared";
import {
  LINK_RATE_LIMIT_MAX_REQUESTS,
  LINK_RATE_LIMIT_PERIOD_SEC,
  LOGIN_BODY_MAX_BYTES,
  RATE_LIMITED_ROUTES,
  RATE_LIMITER_SETTINGS,
  RATE_LIMIT_BINDING_BY_PURPOSE,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_PERIOD_SEC,
  RATE_LIMIT_PURPOSES,
} from "../src/constants";
import type { AppEnv } from "../src/env";
import { app } from "../src/index";
import { onError } from "../src/middleware/error";
import { enforceRateLimit, rateLimitKey, requestIp } from "../src/ratelimit";
import type { ApiOptions } from "./helpers";
import { ALLOW_ALL_RATE_LIMITER, adminSession, api, auditRows, createUser, resetApp } from "./helpers";

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

  it("LINK_RATE_LIMITER 可用，且 constants 的阈值与 wrangler.jsonc 一致", async () => {
    expect(env.LINK_RATE_LIMITER).toBeDefined();
    const key = `consistency:${freshIp()}`;
    const results: boolean[] = [];
    for (let i = 0; i < LINK_RATE_LIMIT_MAX_REQUESTS + 1; i += 1) {
      results.push((await env.LINK_RATE_LIMITER?.limit({ key }))?.success ?? false);
    }
    expect(results.slice(0, LINK_RATE_LIMIT_MAX_REQUESTS).every(Boolean)).toBe(true);
    expect(results[LINK_RATE_LIMIT_MAX_REQUESTS]).toBe(false);
    expect(LINK_RATE_LIMIT_PERIOD_SEC).toBe(RATE_LIMIT_PERIOD_SEC);
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

  // 清单里每条路由：具体子路径与（通配时的）前缀本身都要受保护
  const routeCases = RATE_LIMITED_ROUTES.flatMap((route) => {
    const paths = route.path.endsWith("/*")
      ? [route.path.replace("/*", "/probe"), route.path.replace("/*", "")]
      : [route.path];
    return paths.map((path) => ({ ...route, path, label: `${route.method} ${path}` }));
  });

  const call = (route: { method: string; path: string }, bindings: Parameters<typeof api>[1] = {}) =>
    api(route.path, {
      method: route.method,
      ...(route.method === "GET" ? {} : { json: { username: "x", password: "y" } }),
      ...bindings,
    });

  it.each(routeCases)("$label：超限时 429 + Retry-After，先于任何业务处理", async (route) => {
    const res = await call(route, { bindings: { RATE_LIMITER: DENY_ALL, LINK_RATE_LIMITER: DENY_ALL } });
    expect(res.status).toBe(429);
    const binding = RATE_LIMIT_BINDING_BY_PURPOSE[route.purpose];
    expect(res.headers.get("Retry-After")).toBe(String(RATE_LIMITER_SETTINGS[binding].periodSec));
  });

  it.each(routeCases)("$label：binding 缺失时 503 rate_limiter_not_configured，不放行", async (route) => {
    const res = await call(route, { bindings: { RATE_LIMITER: undefined } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as ErrorBody).error.code).toBe("rate_limiter_not_configured");
  });

  it("清单里每个用途都有对应的 binding，且清单没有重复项", () => {
    for (const route of RATE_LIMITED_ROUTES) expect(RATE_LIMIT_BINDING_BY_PURPOSE[route.purpose]).toBeDefined();
    const keys = RATE_LIMITED_ROUTES.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
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

  it("link 用途只走 LINK_RATE_LIMITER：key 为 link:<token_hash>:<ip>；超限 429 + 该 binding 的 Retry-After", async () => {
    const link = recordingLimiter();
    const general = recordingLimiter();
    const headers = { "CF-Connecting-IP": "192.0.2.5" };
    const bindings = { ...env, RATE_LIMITER: general.limiter, LINK_RATE_LIMITER: link.limiter };
    expect((await linkApp.request("/s/abc123", { headers }, bindings)).status).toBe(200);
    expect(link.keys).toEqual(["link:abc123:192.0.2.5"]);
    expect(general.keys).toEqual([]);

    const limited = await linkApp.request("/s/abc123", { headers }, { ...env, LINK_RATE_LIMITER: DENY_ALL });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe(String(LINK_RATE_LIMIT_PERIOD_SEC));
  });

  it("只缺 LINK_RATE_LIMITER：link 用途 503（RATE_LIMITER 存在也不借用）；反之登录用途不受影响", async () => {
    const headers = { "CF-Connecting-IP": "192.0.2.6" };
    const missing = await linkApp.request("/s/abc123", { headers }, { ...env, LINK_RATE_LIMITER: undefined });
    expect(missing.status).toBe(503);
    expect(((await missing.json()) as ErrorBody).error.code).toBe("rate_limiter_not_configured");

    await resetApp();
    const res = await login("alice", freshIp(), { bindings: { LINK_RATE_LIMITER: undefined } });
    expect(res.status).toBe(401);
  });

  it("rateLimitKey 截断超长片段", () => {
    const key = rateLimitKey(RATE_LIMIT_PURPOSES.loginUser, "a".repeat(1000));
    expect(key.length).toBeLessThan(200);
    expect(key.startsWith("login:user:aaa")).toBe(true);
  });
});

describe("health 的 rate_limit 状态", () => {
  it("两个 binding 分别报告", async () => {
    await resetApp();
    const { cookie } = await adminSession();
    const read = async (bindings: NonNullable<ApiOptions["bindings"]>) =>
      healthResponseSchema.parse(await (await api("/api/admin/system/health", { cookie, bindings })).json()).rate_limit;
    expect(await read({})).toEqual({ configured: true, link_configured: true });
    expect(await read({ RATE_LIMITER: undefined })).toEqual({ configured: false, link_configured: true });
    expect(await read({ LINK_RATE_LIMITER: undefined })).toEqual({ configured: true, link_configured: false });
  });
});

describe("登录请求体大小上限", () => {
  beforeEach(resetApp);

  const oversized = JSON.stringify({ username: "alice", password: "p".repeat(LOGIN_BODY_MAX_BYTES) });

  it("Content-Length 超限：413 payload_too_large，不进入 handler（无审计记录）", async () => {
    const res = await api("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(oversized.length) },
      body: oversized,
    } as Parameters<typeof api>[1]);
    expect(res.status).toBe(413);
    expect(((await res.json()) as ErrorBody).error.code).toBe("payload_too_large");
    expect(await auditRows()).toEqual([]);
  });

  it("没有 Content-Length（流式）也按累计字节截断：413", async () => {
    const encoded = new TextEncoder().encode(oversized);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 1000));
        controller.enqueue(encoded.slice(1000));
        controller.close();
      },
    });
    const res = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { Origin: env.PUBLIC_ORIGIN, "X-MailLink-Csrf": "1", "Content-Type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit,
      { ...env, RATE_LIMITER: ALLOW_ALL_RATE_LIMITER },
    );
    expect(res.status).toBe(413);
  });

  it("正常大小不受影响", async () => {
    const res = await login("alice", freshIp());
    expect(res.status).toBe(401);
  });
});

describe("受保护路径覆盖：app.routes 里的认证类与再确认类写接口都必须在 RATE_LIMITED_ROUTES 里", () => {
  const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  /** 明确不限流的写接口：注销没有可猜的秘密，且应该永远可用 */
  const EXEMPT = new Set(["POST /api/auth/logout"]);

  function isSensitive(path: string): boolean {
    return (
      path === "/api/setup" ||
      path.startsWith("/api/auth/") ||
      /^\/api\/me\/(password|totp|recovery-codes|passkeys)(\/|$)/.test(path)
    );
  }

  /** Hono 语法的清单路径 → 正则：`/*` 匹配前缀本身与其子路径 */
  function matches(pattern: string, path: string): boolean {
    const source = pattern.endsWith("/*") ? `${pattern.slice(0, -2)}(/.*)?` : pattern;
    return new RegExp(`^${source}$`).test(path);
  }

  function findUncovered(routes: ReadonlyArray<{ method: string; path: string }>): string[] {
    return routes
      .filter((route) => WRITE_METHODS.has(route.method) && isSensitive(route.path))
      .map((route) => `${route.method} ${route.path}`)
      .filter((label) => !EXEMPT.has(label))
      .filter((label) => {
        const [method = "", path = ""] = label.split(" ");
        return !RATE_LIMITED_ROUTES.some((entry) => entry.method === method && matches(entry.path, path));
      });
  }

  it("当前应用没有漏挂的写接口", () => {
    const sensitive = app.routes.filter((route) => WRITE_METHODS.has(route.method) && isSensitive(route.path));
    expect(sensitive.length).toBeGreaterThan(0);
    expect(findUncovered(app.routes)).toEqual([]);
  });

  it("检测本身有效：清单外的路由会被报出来，清单内与豁免的不会", () => {
    expect(
      findUncovered([
        { method: "POST", path: "/api/auth/new-secret-check" },
        { method: "DELETE", path: "/api/me/passkeys/:id" },
        { method: "POST", path: "/api/me/totp/disable" },
        { method: "PUT", path: "/api/me/password" },
        { method: "POST", path: "/api/auth/logout" },
        { method: "GET", path: "/api/auth/session" },
        { method: "POST", path: "/api/me/recovery-codes" },
      ]),
    ).toEqual(["POST /api/auth/new-secret-check", "PUT /api/me/password"]);
  });
});
