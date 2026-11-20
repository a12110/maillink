// 组件测试用的 fetch 替身：按 "METHOD /path" 登记响应，记录收到的请求；未登记的请求直接抛错，不静默 404。
import type { PublicConfig } from "@maillink/shared";
import { vi } from "vitest";

export type RecordedRequest = { method: string; path: string; body: unknown };
type Handler = (request: RecordedRequest) => Response | Promise<Response>;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

export function stubFetch(handlers: Record<string, Handler | unknown>) {
  const requests: RecordedRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const request: RecordedRequest = {
      method,
      path: url.pathname,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const handler = handlers[`${method} ${url.pathname}`];
    if (handler === undefined) throw new Error(`测试里没有登记的请求：${method} ${url.pathname}`);
    if (typeof handler === "function") return (handler as Handler)(request);
    return jsonResponse(handler);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}

export function publicConfig(overrides: Partial<PublicConfig> = {}): PublicConfig {
  return {
    site_name: "MailLink",
    site_logo: "",
    site_description: "",
    site_footer: "",
    login_notice: "",
    pickup_notice: "",
    appearance: { preset: "default", accent: "#c8432b", mode: "system", radius: "4" },
    registration_enabled: true,
    login_methods: ["password"],
    oauth_providers: [],
    turnstile: { enabled: false, site_key: "", scopes: [] },
    password_min_length: 10,
    ...overrides,
  };
}
