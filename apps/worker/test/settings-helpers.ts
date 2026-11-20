import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { api } from "./helpers";

// M6 测试共用：各组默认值、保存设置、Turnstile 的 fetch 替身。

export const DEFAULTS = {
  site: { name: "MailLink", logo: "", description: "", footer: "", login_notice: "", pickup_notice: "" },
  appearance: { preset: "default", accent: "#c8432b", mode: "system", radius: "4" },
  auth: { registration_enabled: false, login_methods: ["password", "passkey", "oauth"], oauth_require_2fa: false },
  turnstile: { enabled: false, site_key: "", secret_set: false, scopes: ["login", "register", "pickup"] },
  security: { admin_require_2fa: false, session_idle_sec: 604_800, session_absolute_sec: 2_592_000, password_min_length: 10 },
  links: { default_expires_in_days: null, default_poll_interval_sec: 30, show_brand: true },
  logs: { access_retention_days: 90, audit_retention_days: 365 },
} as const;

export type ApiErrorBody = { error: { code: string; message: string } };

export function putSettings(cookie: string, group: string, body: unknown): Promise<Response> {
  return api(`/api/admin/settings/${group}`, { method: "PUT", json: body, cookie });
}

export function getSettingsGroup(cookie: string, group: string): Promise<Response> {
  return api(`/api/admin/settings/${group}`, { cookie });
}

/** 保存并断言成功，返回响应体 */
export async function saveSettings(cookie: string, group: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await putSettings(cookie, group, body);
  if (res.status !== 200) throw new Error(`保存 ${group} 失败 ${res.status}: ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as ApiErrorBody).error.code;
}

export const TURNSTILE_SECRET = "0x4AAAA-test-secret-value";
export const TURNSTILE_SITE_KEY = "0x4AAAA-test-site-key";

export function enableTurnstile(cookie: string, scopes: string[]): Promise<Record<string, unknown>> {
  return saveSettings(cookie, "turnstile", { enabled: true, site_key: TURNSTILE_SITE_KEY, secret: TURNSTILE_SECRET, scopes });
}

export async function setRawSetting(key: string, value: unknown): Promise<void> {
  await env.APP_DB
    .prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, 0)")
    .bind(key, JSON.stringify(value))
    .run();
}

export type SiteverifyCall = { url: string; method: string; form: URLSearchParams };

/**
 * 拦截 fetch 模拟 Turnstile siteverify：token 为 `good` 时通过（响应带本站 hostname 与 action），其余按 success:false 返回；
 * calls 记录每次请求。action 是"控件渲染时传的 action"，应与被测入口的 scope 同名。
 */
export function installTurnstileFetch(respond?: (form: URLSearchParams) => Response, action = "login"): SiteverifyCall[] {
  const calls: SiteverifyCall[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const form = new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()));
    calls.push({ url: request.url, method: request.method, form });
    if (respond) return respond(form);
    const good = form.get("response") === "good";
    const hostname = new URL(env.PUBLIC_ORIGIN).hostname;
    return Response.json(good ? { success: true, hostname, action } : { success: false, "error-codes": ["invalid-input-response"] });
  });
  return calls;
}
