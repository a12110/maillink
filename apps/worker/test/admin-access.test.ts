import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { adminSession, api, createSessionCookie, createUser, resetApp } from "./helpers";

type ErrorBody = { error: { code: string; message: string } };

const ADMIN_ROUTES: Array<{ method: string; path: string; json?: unknown }> = [
  { method: "GET", path: "/api/admin/system/health" },
  { method: "GET", path: "/api/admin/users" },
  { method: "POST", path: "/api/admin/users", json: { username: "newbie", password: "a-long-enough-password" } },
  { method: "GET", path: "/api/admin/users/1" },
  { method: "PATCH", path: "/api/admin/users/1", json: { display_name: "x" } },
  { method: "DELETE", path: "/api/admin/users/1" },
  { method: "POST", path: "/api/admin/users/1/password", json: { password: "a-long-enough-password" } },
  { method: "DELETE", path: "/api/admin/users/1/sessions" },
  // 尚不存在的 /api/admin/* 路径也先鉴权，不泄露路由是否存在
  { method: "GET", path: "/api/admin/not-yet-built" },
];

describe("/api/admin/* 访问控制", () => {
  beforeEach(resetApp);

  it("未登录：全部 401 unauthenticated", async () => {
    for (const route of ADMIN_ROUTES) {
      const res = await api(route.path, { method: route.method, json: route.json });
      expect(res.status, `${route.method} ${route.path}`).toBe(401);
      expect(((await res.json()) as ErrorBody).error.code).toBe("unauthenticated");
    }
  });

  it("普通用户：全部 403 forbidden，且没有产生副作用", async () => {
    const userId = await createUser({ username: "plain" });
    const { cookie } = await createSessionCookie(userId);
    for (const route of ADMIN_ROUTES) {
      const res = await api(route.path, { method: route.method, json: route.json, cookie });
      expect(res.status, `${route.method} ${route.path}`).toBe(403);
      expect(((await res.json()) as ErrorBody).error.code).toBe("forbidden");
    }
    const count = await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("管理员：health 可访问", async () => {
    const { cookie } = await adminSession();
    expect((await api("/api/admin/system/health", { cookie })).status).toBe(200);
  });

  it("被禁用的管理员：401", async () => {
    const id = await createUser({ username: "gone", role: "admin" });
    const { cookie } = await createSessionCookie(id);
    await env.APP_DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind(id).run();
    expect((await api("/api/admin/users", { cookie })).status).toBe(401);
  });
});

describe("公开接口", () => {
  beforeEach(resetApp);

  it("GET /api/public/config：默认值（站点名、关闭注册、密码与通行密钥；没有提供方时不列 oauth），免登录", async () => {
    const res = await api("/api/public/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      site_name: "MailLink",
      site_logo: "",
      site_description: "",
      site_footer: "",
      login_notice: "",
      pickup_notice: "",
      appearance: { preset: "default", accent: "#c8432b", mode: "system", radius: "4" },
      registration_enabled: false,
      login_methods: ["password", "passkey"],
      oauth_providers: [],
      turnstile: { enabled: false, site_key: "", scopes: ["login", "register", "pickup"] },
    });
  });

  it("库里的设置覆盖默认值", async () => {
    await env.APP_DB
      .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('site.name', '\"我的站点\"', 1), ('registration.enabled', 'true', 1)")
      .run();
    expect(await (await api("/api/public/config")).json()).toMatchObject({
      site_name: "我的站点",
      registration_enabled: true,
      login_methods: ["password", "passkey"],
      oauth_providers: [],
    });
  });
});
