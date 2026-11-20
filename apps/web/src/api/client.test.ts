import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from "@maillink/shared";
import { createApiClient } from "./client";
import { ApiError, NetworkError, ResponseFormatError } from "./errors";

const okSchema = z.object({ status: z.literal("ok") });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setup(respond: () => Promise<Response> | Response) {
  const fetchImpl = vi.fn<typeof fetch>(async () => respond());
  const onUnauthorized = vi.fn();
  return { client: createApiClient({ fetchImpl, onUnauthorized }), fetchImpl, onUnauthorized };
}

function lastInit(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>): RequestInit {
  const init = fetchImpl.mock.calls.at(-1)?.[1];
  if (!init) throw new Error("fetch 没有被调用");
  return init;
}

describe("API 客户端", () => {
  it("GET：同源 Cookie，不带 CSRF 头，query 跳过空值", async () => {
    const { client, fetchImpl } = setup(() => jsonResponse({ status: "ok" }));
    await client.request({ path: "/api/x", query: { q: "a b", role: undefined, cursor: "" }, schema: okSchema });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/api/x?q=a+b");
    const init = lastInit(fetchImpl);
    expect(init.credentials).toBe("same-origin");
    expect(init.headers).not.toHaveProperty(CSRF_HEADER_NAME);
  });

  it.each(["POST", "PATCH", "PUT", "DELETE"] as const)("%s：自动带 CSRF 头，JSON 请求体", async (method) => {
    const { client, fetchImpl } = setup(() => jsonResponse({ status: "ok" }));
    await client.request({ method, path: "/api/x", body: { a: 1 }, schema: okSchema });
    const init = lastInit(fetchImpl);
    expect(init.headers).toMatchObject({ [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE, "Content-Type": "application/json" });
    expect(init.body).toBe('{"a":1}');
  });

  it("统一错误体解析成带 code 的 ApiError", async () => {
    const { client } = setup(() => jsonResponse({ error: { code: "last_admin_protected", message: "不能…" } }, 409));
    const error = await client.request({ path: "/api/x", schema: okSchema }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "last_admin_protected", message: "不能…" });
  });

  it("错误体里 code / message 之外的字段（如 issues）保留在 details 里，供编辑器按路径定位", async () => {
    const issues = [{ code: "empty_value", severity: "error", path: ["a"], message: "m" }];
    const { client } = setup(() => jsonResponse({ error: { code: "rule_group_invalid", message: "规则组配置不合法", issues, warnings: [] } }, 400));
    const error = await client.request({ path: "/api/x", schema: okSchema }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).details).toEqual({ issues, warnings: [] });
    expect(error).toMatchObject({ status: 400, code: "rule_group_invalid" });
  });

  it("非统一格式的错误响应（如 HTML 502）标成 unexpected_response", async () => {
    const { client } = setup(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const error = await client.request({ path: "/api/x", schema: okSchema }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, code: "unexpected_response" });
  });

  it("成功响应不符合 schema：抛 ResponseFormatError，不静默", async () => {
    const { client } = setup(() => jsonResponse({ status: "nope" }));
    await expect(client.request({ path: "/api/x", schema: okSchema })).rejects.toBeInstanceOf(ResponseFormatError);
  });

  it("成功响应不是 JSON：抛 ResponseFormatError", async () => {
    const { client } = setup(() => new Response("hello", { status: 200 }));
    await expect(client.request({ path: "/api/x", schema: okSchema })).rejects.toBeInstanceOf(ResponseFormatError);
  });

  it("fetch 失败：抛 NetworkError 并保留原因", async () => {
    const cause = new TypeError("Failed to fetch");
    const { client } = setup(() => Promise.reject(cause));
    const error = await client.request({ path: "/api/x", schema: okSchema }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).cause).toBe(cause);
  });

  it("401：触发 onUnauthorized 并仍然抛 ApiError", async () => {
    const { client, onUnauthorized } = setup(() => jsonResponse({ error: { code: "unauthorized", message: "未登录" } }, 401));
    await expect(client.request({ path: "/api/x", schema: okSchema })).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("401 且 handleUnauthorized=false（登录、查会话）：不触发跳转", async () => {
    const { client, onUnauthorized } = setup(() =>
      jsonResponse({ error: { code: "invalid_credentials", message: "用户名或密码错误" } }, 401),
    );
    await expect(
      client.request({ method: "POST", path: "/api/auth/login", schema: okSchema, handleUnauthorized: false }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("其他错误状态不触发 onUnauthorized", async () => {
    const { client, onUnauthorized } = setup(() => jsonResponse({ error: { code: "forbidden", message: "x" } }, 403));
    await expect(client.request({ path: "/api/x", schema: okSchema })).rejects.toMatchObject({ status: 403 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
