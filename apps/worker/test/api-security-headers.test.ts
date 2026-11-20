import { beforeEach, describe, expect, it } from "vitest";
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
