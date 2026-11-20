import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppEnv } from "../src/env";
import { app } from "../src/index";
import { apiSecurityHeaders } from "../src/middleware/security-headers";
import { putMail } from "./access-helpers";
import { adminSession, api, createSessionCookie, createUser, resetApp } from "./helpers";
import { insertGrant, insertMailbox } from "./grants-helpers";

// 所有 /api/* 响应都带 X-Content-Type-Options: nosniff 与 Referrer-Policy: no-referrer（含错误、404、CSRF 拒绝、限流拒绝、原始 Response）。

beforeEach(resetApp);

function expectSecurityHeaders(res: Response, label: string): void {
  expect(res.headers.get("X-Content-Type-Options"), label).toBe("nosniff");
  expect(res.headers.get("Referrer-Policy"), label).toBe("no-referrer");
}

describe("API 统一安全头", () => {
  it("成功、未登录、权限不足、404、CSRF 拒绝、限流未配置都带", async () => {
    const user = await createUser({ username: "bob" });
    const userCookie = (await createSessionCookie(user)).cookie;
    const cases: Array<[string, Response, number]> = [
      ["public config", await api("/api/public/config"), 200],
      ["unauthenticated", await api("/api/me"), 401],
      ["forbidden", await api("/api/admin/users", { cookie: userCookie }), 403],
      ["unknown api", await api("/api/no-such-route"), 404],
      ["csrf", await api("/api/auth/login", { json: { username: "x", password: "y" }, csrf: false }), 403],
      [
        "rate limiter missing",
        await api("/api/auth/login", { json: { username: "x", password: "y" }, bindings: { RATE_LIMITER: undefined } }),
        503,
      ],
    ];
    for (const [label, res, status] of cases) {
      expect(res.status, label).toBe(status);
      expectSecurityHeaders(res, label);
    }
  });

  it("路由直接返回的 Response（附件下载）也带上，原有头保持", async () => {
    const admin = await adminSession();
    const id = await putMail({ address: "a@example.com", subject: "s", attachment: { name: "a.txt", content: "hello" } });
    const res = await api(`/api/admin/mails/${id}/attachments/0`, { cookie: admin.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expectSecurityHeaders(res, "attachment");

    const box = await insertMailbox("a@example.com");
    await insertGrant({ userId: admin.id, mailboxId: box });
    const mine = await api(`/api/me/mails/${id}?mailbox_id=${box}`, { cookie: admin.cookie });
    expectSecurityHeaders(mine, "me mail detail");
  });
});

// FIN-A：/api/* 默认 Cache-Control: no-store；路由显式设置的保留
describe("API 默认 no-store", () => {
  it("已登录 GET（会话、用户列表、设置、本人资料等）与错误响应都带 no-store", async () => {
    const admin = await adminSession();
    const user = await createUser({ username: "bob" });
    const userCookie = (await createSessionCookie(user)).cookie;
    const cases: Array<[string, Response, number]> = [
      ["session", await api("/api/auth/session", { cookie: admin.cookie }), 200],
      ["user list", await api("/api/admin/users", { cookie: admin.cookie }), 200],
      ["settings", await api("/api/admin/settings/site", { cookie: admin.cookie }), 200],
      ["system status", await api("/api/admin/settings/system", { cookie: admin.cookie }), 200],
      ["me", await api("/api/me", { cookie: userCookie }), 200],
      ["my sessions", await api("/api/me/sessions", { cookie: userCookie }), 200],
      ["my identities", await api("/api/me/identities", { cookie: userCookie }), 200],
      ["unauthenticated", await api("/api/me"), 401],
      ["forbidden", await api("/api/admin/users", { cookie: userCookie }), 403],
      ["not found", await api("/api/admin/users/9999", { cookie: admin.cookie }), 404],
      ["unknown api", await api("/api/no-such-route"), 404],
      ["csrf", await api("/api/auth/login", { json: { username: "x", password: "y" }, csrf: false }), 403],
    ];
    for (const [label, res, status] of cases) {
      expect(res.status, label).toBe(status);
      expect(res.headers.get("Cache-Control"), label).toBe("no-store");
    }
  });

  it("app 里注册的每个 GET 路由（参数填占位值）响应都带 no-store", async () => {
    const admin = await adminSession();
    const paths = [...new Set(app.routes.filter((route) => route.method === "GET" && route.path.startsWith("/api/")).map((route) => route.path))];
    expect(paths.length).toBeGreaterThan(20);
    for (const path of paths) {
      const res = await api(path.replace(/\/:[^/]+/g, "/1"), { cookie: admin.cookie });
      expect(res.headers.get("Cache-Control"), `${path} → ${res.status}`).toContain("no-store");
    }
  });

  it("路由显式设置的 Cache-Control 保留，不被覆盖", async () => {
    const mini = new Hono<AppEnv>();
    mini.use("*", apiSecurityHeaders);
    mini.get("/explicit", (c) => {
      c.header("Cache-Control", "private, max-age=60");
      return c.text("ok");
    });
    mini.get("/raw", () => new Response("x", { headers: { "Cache-Control": "no-cache" } }));
    mini.get("/default", (c) => c.text("ok"));
    expect((await mini.request("/explicit")).headers.get("Cache-Control")).toBe("private, max-age=60");
    expect((await mini.request("/raw")).headers.get("Cache-Control")).toBe("no-cache");
    expect((await mini.request("/default")).headers.get("Cache-Control")).toBe("no-store");
  });
});
