import { env } from "cloudflare:workers";
import { CSRF_HEADER_NAME } from "@maillink/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { adminSession, api, resetApp } from "./helpers";

type ErrorBody = { error: { code: string; message: string } };

const LOGIN_BODY = { username: "nobody", password: "whatever-password" };

describe("CSRF 防护", () => {
  beforeEach(resetApp);

  it("缺少自定义请求头：403 csrf_header_missing", async () => {
    const res = await api("/api/auth/login", { json: LOGIN_BODY, csrf: false });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe("csrf_header_missing");
  });

  it("请求头值不对：403", async () => {
    const res = await api("/api/auth/login", { json: LOGIN_BODY, csrf: false, headers: { [CSRF_HEADER_NAME]: "0" } });
    expect(res.status).toBe(403);
  });

  it("Origin 与 PUBLIC_ORIGIN 不一致：403 csrf_origin_mismatch", async () => {
    for (const origin of ["https://evil.example", "http://localhost:9999", `${env.PUBLIC_ORIGIN}.evil.example`, "null"]) {
      const res = await api("/api/auth/login", { json: LOGIN_BODY, origin });
      expect(res.status).toBe(403);
      expect(((await res.json()) as ErrorBody).error.code).toBe("csrf_origin_mismatch");
    }
  });

  it("缺少 Origin：403", async () => {
    const res = await api("/api/auth/login", { json: LOGIN_BODY, origin: false });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe("csrf_origin_mismatch");
  });

  it("Origin 与请求头都正确：通过 CSRF 检查（这里继续走到登录逻辑，返回 401）", async () => {
    const res = await api("/api/auth/login", { json: LOGIN_BODY });
    expect(res.status).toBe(401);
  });

  it("GET 不需要 Origin 与请求头", async () => {
    expect((await api("/api/setup/status")).status).toBe(200);
  });

  it("PUT / PATCH / DELETE 同样检查（并且先于鉴权）", async () => {
    const { cookie } = await adminSession();
    for (const method of ["PATCH", "DELETE", "PUT", "POST"]) {
      const res = await api("/api/admin/users/1", { method, cookie, csrf: false });
      expect(res.status, method).toBe(403);
    }
    // 未登录也是先 403
    const anonymous = await api("/api/admin/users/1", { method: "DELETE", csrf: false });
    expect(anonymous.status).toBe(403);
  });
});
