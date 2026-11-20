import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { request as playwrightRequest } from "@playwright/test";
import type { APIResponse } from "@playwright/test";
import { ADMIN_STATE, userAccount } from "../support/accounts";
import { createUserViaApi, loginWithPassword } from "../support/actions";
import { ORIGIN } from "../support/env";
import { expect, test, WRITE_HEADERS } from "../support/fixtures";

const ADMIN_GET_PATHS = [
  "/api/admin/users",
  "/api/admin/mailboxes",
  "/api/admin/rule-groups",
  "/api/admin/mails",
  "/api/admin/grants",
  "/api/admin/audit-logs",
  "/api/admin/settings/site",
  "/api/admin/system/health",
];

async function errorCode(response: APIResponse): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

test("安全路径：未登录访问 /api/admin/* 一律 401", async ({ request }) => {
  for (const path of ADMIN_GET_PATHS) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
    expect(await errorCode(response), path).toBe("unauthenticated");
  }
  // 这是登录页本身就会发的请求：未登录时 401 属于预期
  expect((await request.get("/api/auth/session")).status()).toBe(401);
});

test("安全路径：普通用户访问 /api/admin/* 为 403，/admin 页面被挡回 /inbox", async ({ page, adminApi }) => {
  const account = userAccount("plain");
  await createUserViaApi(adminApi, account);
  await loginWithPassword(page, account, "/inbox");
  const api = page.context().request;

  for (const path of ADMIN_GET_PATHS) {
    const response = await api.get(path);
    expect(response.status(), path).toBe(403);
    expect(await errorCode(response), path).toBe("forbidden");
  }
  // 带齐 Origin 与 CSRF 头的写请求也一样被挡，且没有产生副作用
  const write = await api.post("/api/admin/users", { headers: WRITE_HEADERS, data: { username: "e2e-sneaky", password: "e2e-sneaky-password-1", role: "admin" } });
  expect(write.status()).toBe(403);
  const found = await adminApi.get("/api/admin/users?q=e2e-sneaky");
  expect(((await found.json()) as { items: unknown[] }).items).toHaveLength(0);

  for (const path of ["/admin/users", "/admin/mailboxes", "/admin/settings/site", "/admin/audit"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/inbox$/);
    await expect(page.getByRole("heading", { name: "我的邮件", level: 1 })).toBeVisible();
  }
  const nav = page.getByRole("navigation", { name: "主导航" });
  await expect(nav.getByRole("link")).toHaveText(["我的邮件", "账号安全"]);
});

test("安全路径：写请求缺 CSRF 头或 Origin 不对一律被拒，且没有副作用", async () => {
  const body = { username: "e2e-csrf-victim", password: "e2e-csrf-password-1", role: "user" };
  const noCsrfHeader = await playwrightRequest.newContext({ baseURL: ORIGIN, storageState: ADMIN_STATE, extraHTTPHeaders: { Origin: ORIGIN } });
  const wrongOrigin = await playwrightRequest.newContext({
    baseURL: ORIGIN,
    storageState: ADMIN_STATE,
    extraHTTPHeaders: { Origin: "http://evil.example.com", "X-MailLink-Csrf": "1" },
  });
  const noOrigin = await playwrightRequest.newContext({ baseURL: ORIGIN, storageState: ADMIN_STATE, extraHTTPHeaders: { "X-MailLink-Csrf": "1" } });
  const wrongCsrfValue = await playwrightRequest.newContext({ baseURL: ORIGIN, storageState: ADMIN_STATE, extraHTTPHeaders: { Origin: ORIGIN, "X-MailLink-Csrf": "0" } });

  const cases = [
    { context: noCsrfHeader, code: "csrf_header_missing" },
    { context: wrongCsrfValue, code: "csrf_header_missing" },
    { context: wrongOrigin, code: "csrf_origin_mismatch" },
    { context: noOrigin, code: "csrf_origin_mismatch" },
  ];
  for (const { context, code } of cases) {
    const response = await context.post("/api/admin/users", { data: body });
    expect(response.status()).toBe(403);
    expect(await errorCode(response)).toBe(code);
  }
  // 登录接口也受同样的检查（不带头的跨站表单提交无法登录）
  const login = await noCsrfHeader.post("/api/auth/login", { data: { username: "x", password: "y" } });
  expect(login.status()).toBe(403);

  // 对照：同一份会话、同样的请求体，头齐全时可以创建，说明上面的拒绝确实来自 CSRF 检查
  const ok = await playwrightRequest.newContext({ baseURL: ORIGIN, storageState: ADMIN_STATE, extraHTTPHeaders: WRITE_HEADERS });
  const before = (await (await ok.get("/api/admin/users?q=e2e-csrf-victim")).json()) as { items: unknown[] };
  expect(before.items).toHaveLength(0);
  expect((await ok.post("/api/admin/users", { data: body })).status()).toBe(201);
  await Promise.all([noCsrfHeader, wrongOrigin, noOrigin, wrongCsrfValue, ok].map((context) => context.dispose()));
});

test("安全路径：/api/* 响应带安全头，页面响应带 _headers 里的 CSP", async ({ request }) => {
  // API：成功、401、404 都带 nosniff 与 no-referrer
  for (const path of ["/api/public/config", "/api/admin/users", "/api/no-such-route"]) {
    const headers = (await request.get(path)).headers();
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("no-referrer");
  }

  // 页面：由静态资源直出，CSP 与构建生成的 dist/_headers 一致
  const generated = readFileSync(resolve(import.meta.dirname, "../../web/dist/_headers"), "utf8");
  const expectedCsp = /^\s+Content-Security-Policy:\s*(.+)$/m.exec(generated)?.[1]?.trim();
  expect(expectedCsp, "dist/_headers 里应有 CSP").toBeTruthy();
  for (const path of ["/", "/login", "/inbox", "/s/some-token"]) {
    const headers = (await request.get(path)).headers();
    expect(headers["content-security-policy"], path).toBe(expectedCsp);
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("no-referrer");
    expect(headers["x-frame-options"], path).toBe("DENY");
  }
  expect(expectedCsp).toContain("frame-ancestors 'none'");
  expect(expectedCsp).toContain("default-src 'self'");
  expect(expectedCsp).not.toContain("'unsafe-eval'");
  // 取件页另有不缓存、不收录
  const pickup = (await request.get("/s/some-token")).headers();
  expect(pickup["cache-control"]).toBe("no-store");
  expect(pickup["x-robots-tag"]).toBe("noindex, nofollow");
});
