import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkPublicStatusSchema, type AdminShareLink, type LinkPublicStatus, type ShareLinkCreate } from "@maillink/shared";
import { LINK_DEFAULT_EXPIRES_UNIT_SEC, TURNSTILE_VERIFY_URL } from "../src/constants";
import { adminSession, api, resetApp } from "./helpers";
import { accessLogs, createLink, createLinks, createRuleGroup, importMailboxes, linkRow, publicApi, tableCounts, visitorCookie, type ErrorBody } from "./link-helpers";
import { DEFAULTS, TURNSTILE_SITE_KEY, enableTurnstile, installTurnstileFetch, saveSettings, setRawSetting } from "./settings-helpers";

// INT-1：取件链接（M3b-2）与系统设置 / Turnstile（M6）的集成。

let cookie: string;
let groupId: number;
let mailboxId: number;
const nowSec = () => Math.floor(Date.now() / 1000);

beforeEach(async () => {
  await resetApp();
  cookie = (await adminSession()).cookie;
  groupId = await createRuleGroup(cookie);
  mailboxId = (await importMailboxes(cookie, ["box@example.com", "box2@example.com"])).get("box@example.com") as number;
});
afterEach(() => vi.restoreAllMocks());

const body = (extra: Partial<ShareLinkCreate> = {}): ShareLinkCreate => ({ mailbox_ids: [mailboxId], rule_group_id: groupId, ...extra });
const newLink = (extra: Partial<ShareLinkCreate> = {}) => createLink(cookie, body(extra));
const forcedLink = (extra: Partial<ShareLinkCreate["access"] & object> = {}) => newLink({ access: { turnstile: true, ...extra } });
const start = (token: string, json: unknown = {}, visitor = {}) => publicApi(`/api/s/${token}/start`, visitor, { json });
const errorOf = async (res: Response) => {
  const { error } = await res.json<ErrorBody>();
  return { status: res.status, code: error.code };
};
const statusOf = async (token: string) => await (await publicApi(`/api/s/${token}`)).json<LinkPublicStatus>();
const attemptCount = async () => (await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM link_password_attempts").first<{ n: number }>())?.n ?? 0;

describe("链接保存 turnstile=true", () => {
  const create = (access: { turnstile: boolean }) => api("/api/admin/links", { cookie, json: body({ access }) });

  it("系统未配置（默认）：创建 400 turnstile_not_configured，PATCH 同样", async () => {
    expect(await errorOf(await create({ turnstile: true }))).toEqual({ status: 400, code: "turnstile_not_configured" });
    const { id } = await newLink();
    const patch = await api(`/api/admin/links/${id}`, { cookie, method: "PATCH", json: { access: { turnstile: true } } });
    expect(await errorOf(patch)).toEqual({ status: 400, code: "turnstile_not_configured" });
    expect(await tableCounts()).toMatchObject({ share_links: 1 });
  });

  it("启用但范围不含 pickup、已停用、缺 secret、缺 site key：都是 400", async () => {
    await enableTurnstile(cookie, ["login", "register"]);
    expect((await create({ turnstile: true })).status).toBe(400);
    await enableTurnstile(cookie, ["pickup"]);
    await saveSettings(cookie, "turnstile", { enabled: false, site_key: TURNSTILE_SITE_KEY, scopes: ["pickup"] });
    expect((await create({ turnstile: true })).status).toBe(400);
    await saveSettings(cookie, "turnstile", { enabled: true, site_key: TURNSTILE_SITE_KEY, scopes: ["pickup"] });
    expect((await create({ turnstile: true })).status).toBe(201);
    await env.APP_DB.prepare("DELETE FROM settings WHERE key = 'turnstile.secret_enc'").run();
    expect((await create({ turnstile: true })).status).toBe(400);
    await enableTurnstile(cookie, ["pickup"]);
    await setRawSetting("turnstile.site_key", "");
    expect((await create({ turnstile: true })).status).toBe(400);
  });

  it("系统已配置：创建、多地址批量创建、PATCH 都可以保存；关闭不受限制", async () => {
    await enableTurnstile(cookie, ["pickup"]);
    const single = await createLinks(cookie, body({ access: { turnstile: true } }));
    expect(single.items[0]?.link.access.turnstile).toBe(true);
    const box2 = (await env.APP_DB.prepare("SELECT id FROM mailboxes WHERE address = 'box2@example.com'").first<{ id: number }>())?.id as number;
    const many = await createLinks(cookie, { mailbox_ids: [mailboxId, box2], rule_group_id: groupId, access: { turnstile: true } });
    expect(many.items.map((item) => item.link.access.turnstile)).toEqual([true, true]);
    const plain = await newLink();
    const patched = await api(`/api/admin/links/${plain.id}`, { cookie, method: "PATCH", json: { access: { turnstile: true } } });
    expect(patched.status).toBe(200);
    expect((await patched.json<AdminShareLink>()).access.turnstile).toBe(true);
    await saveSettings(cookie, "turnstile", { enabled: false, site_key: TURNSTILE_SITE_KEY, scopes: ["pickup"] });
    const off = await api(`/api/admin/links/${plain.id}`, { cookie, method: "PATCH", json: { access: { turnstile: false } } });
    expect(off.status).toBe(200);
  });
});

describe("POST /start 的人机验证", () => {
  beforeEach(async () => {
    await enableTurnstile(cookie, ["pickup"]);
  });

  it("forced 链接没有 token：400 turnstile_failed，不调用 Cloudflare，不登记设备，写 denied 日志", async () => {
    const { id, token } = await forcedLink();
    const calls = installTurnstileFetch(undefined, "pickup");
    const res = await start(token);
    expect(await errorOf(res)).toEqual({ status: 400, code: "turnstile_failed" });
    expect(res.headers.getSetCookie().find((line) => line.startsWith("mlv_"))).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect((await tableCounts()).link_visitors).toBe(0);
    expect((await linkRow(id)).first_access_at).toBeNull();
    expect(await accessLogs(id)).toEqual([{ event: "denied", reason: "turnstile_failed", mail_id: null }]);
  });

  it("token 有效：200 并登记设备；请求发往固定地址，带 secret、response、remoteip", async () => {
    const { id, token } = await forcedLink();
    const calls = installTurnstileFetch(undefined, "pickup");
    const res = await start(token, { turnstile_token: "good" });
    expect(res.status).toBe(200);
    expect(await res.json<LinkPublicStatus>()).toMatchObject({ state: "active", visitor_registered: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(TURNSTILE_VERIFY_URL);
    expect(calls[0]?.form.get("response")).toBe("good");
    expect(calls[0]?.form.get("remoteip")).toBe("203.0.113.7");
    expect((await accessLogs(id)).map((log) => log.event)).toEqual(["start"]);
  });

  it("token 无效、或 action 不是 pickup：400 turnstile_failed", async () => {
    const { token } = await forcedLink();
    installTurnstileFetch(undefined, "pickup");
    expect(await errorOf(await start(token, { turnstile_token: "bad" }))).toEqual({ status: 400, code: "turnstile_failed" });
    vi.restoreAllMocks();
    installTurnstileFetch(undefined, "login");
    expect(await errorOf(await start(token, { turnstile_token: "good" }))).toEqual({ status: 400, code: "turnstile_failed" });
    expect((await tableCounts()).link_visitors).toBe(0);
  });

  it("token 超过长度上限：400 validation_error，不调用 Cloudflare", async () => {
    const { token } = await forcedLink();
    const calls = installTurnstileFetch(undefined, "pickup");
    expect(await errorOf(await start(token, { turnstile_token: "x".repeat(2049) }))).toEqual({ status: 400, code: "validation_error" });
    expect(calls).toHaveLength(0);
  });

  it("系统后来被停用：503 turnstile_not_configured，写 denied 日志", async () => {
    const { id, token } = await forcedLink();
    await saveSettings(cookie, "turnstile", { enabled: false, site_key: TURNSTILE_SITE_KEY, scopes: ["pickup"] });
    const calls = installTurnstileFetch(undefined, "pickup");
    expect(await errorOf(await start(token, { turnstile_token: "good" }))).toEqual({ status: 503, code: "turnstile_not_configured" });
    expect(calls).toHaveLength(0);
    expect((await tableCounts()).link_visitors).toBe(0);
    expect(await accessLogs(id)).toEqual([{ event: "denied", reason: "turnstile_unavailable", mail_id: null }]);
  });

  it("Cloudflare 校验服务异常：503 turnstile_unavailable，不放行", async () => {
    const { token } = await forcedLink();
    vi.spyOn(console, "error").mockImplementation(() => {});
    installTurnstileFetch(() => new Response("boom", { status: 500 }), "pickup");
    expect(await errorOf(await start(token, { turnstile_token: "good" }))).toEqual({ status: 503, code: "turnstile_unavailable" });
    expect((await tableCounts()).link_visitors).toBe(0);
  });

  it("已登记设备再点开始取码：不要求 token，不调用 Cloudflare", async () => {
    const { token } = await forcedLink();
    const calls = installTurnstileFetch(undefined, "pickup");
    const first = await start(token, { turnstile_token: "good" });
    const deviceCookie = visitorCookie(first);
    expect(calls).toHaveLength(1);
    const again = await start(token, {}, { cookie: deviceCookie });
    expect(again.status).toBe(200);
    expect(await again.json<LinkPublicStatus>()).toMatchObject({ visitor_registered: true });
    expect(calls).toHaveLength(1);
    expect((await tableCounts()).link_visitors).toBe(1);
  });

  it("非 forced 链接：系统范围含 pickup 也不校验，没有 token 照常通过", async () => {
    const { token } = await newLink();
    const calls = installTurnstileFetch(undefined, "pickup");
    expect((await start(token)).status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it("Turnstile 先于口令：失败的请求不进 PBKDF2、不占口令名额；通过后错口令才计一次", async () => {
    const { id, token } = await forcedLink({ password: "open-sesame" });
    const calls = installTurnstileFetch(undefined, "pickup");
    expect((await start(token, { password: "wrong-password" })).status).toBe(400);
    expect((await start(token, { password: "open-sesame", turnstile_token: "bad" })).status).toBe(400);
    expect(await attemptCount()).toBe(0);
    expect(calls).toHaveLength(1);
    const wrong = await start(token, { password: "wrong-password", turnstile_token: "good" });
    expect(await errorOf(wrong)).toEqual({ status: 403, code: "link_password_invalid" });
    expect(await attemptCount()).toBe(1);
    const ok = await start(token, { password: "open-sesame", turnstile_token: "good" });
    expect(ok.status).toBe(200);
    expect((await accessLogs(id)).map((log) => log.reason)).toEqual(["turnstile_failed", "turnstile_failed", "bad_password", null]);
  });

  it("被拒的 POST 先限流再写日志：限流器全拒时 429 且 0 条日志", async () => {
    const { id, token } = await forcedLink();
    const denyAll: RateLimit = { limit: async () => ({ success: false }) };
    const res = await publicApi(`/api/s/${token}/start`, {}, { json: {}, bindings: { LINK_RATE_LIMITER: denyAll } });
    expect(res.status).toBe(429);
    expect(await accessLogs(id)).toEqual([]);
  });
});

describe("GET /api/s/:token 带出取件页设置", () => {
  it("默认：站点名称、不要求人机验证；没有 logo 与 notice 字段", async () => {
    const { token } = await newLink();
    const status = await statusOf(token);
    expect(linkPublicStatusSchema.safeParse(status).success).toBe(true);
    expect(status.turnstile).toEqual({ required: false });
    expect(status.site).toEqual({ show_brand: true, name: "MailLink" });
    expect(status.requires_turnstile).toBe(false);
  });

  it("forced 链接：required=true 并给 site_key；非 forced 链接即使系统已配置也不给", async () => {
    await enableTurnstile(cookie, ["pickup"]);
    const forced = await forcedLink();
    const plain = await newLink();
    expect((await statusOf(forced.token)).turnstile).toEqual({ required: true, site_key: TURNSTILE_SITE_KEY });
    expect((await statusOf(plain.token)).turnstile).toEqual({ required: false });
  });

  it("forced 链接但系统已不再配置 site key：required=true，不给 site_key", async () => {
    await enableTurnstile(cookie, ["pickup"]);
    const { token } = await forcedLink();
    await setRawSetting("turnstile.site_key", "");
    expect((await statusOf(token)).turnstile).toEqual({ required: true });
  });

  it("show_brand=false：不给 name / logo，公告仍给", async () => {
    const logo = "data:image/png;base64,iVBORw0KGgo=";
    await saveSettings(cookie, "site", { ...DEFAULTS.site, name: "Acme", logo, pickup_notice: "客服 17:00 下班" });
    await saveSettings(cookie, "links", { ...DEFAULTS.links, show_brand: false });
    const { token } = await newLink();
    expect((await statusOf(token)).site).toEqual({ show_brand: false, notice: "客服 17:00 下班" });
  });

  it("show_brand=true：data URI Logo 原样给出，并带 name 与 notice", async () => {
    const logo = "data:image/png;base64,iVBORw0KGgo=";
    await saveSettings(cookie, "site", { ...DEFAULTS.site, name: "Acme", logo, pickup_notice: "注意查收" });
    const { token } = await newLink();
    expect((await statusOf(token)).site).toEqual({ show_brand: true, name: "Acme", logo, notice: "注意查收" });
  });

  it("https Logo 一律不给（取件页不加载第三方资源）", async () => {
    await saveSettings(cookie, "site", { ...DEFAULTS.site, name: "Acme", logo: "https://cdn.example.com/logo.png" });
    const { token } = await newLink();
    const response = await publicApi(`/api/s/${token}`);
    expect(await response.text()).not.toContain("cdn.example.com");
    expect((await statusOf(token)).site).toEqual({ show_brand: true, name: "Acme" });
  });
});

describe("创建链接的默认值", () => {
  const view = async (id: number) => await (await api(`/api/admin/links/${id}`, { cookie })).json<AdminShareLink>();

  it("默认设置：不过期，轮询间隔 30 秒", async () => {
    const { id } = await newLink();
    expect((await linkRow(id)).expires_at).toBeNull();
    expect((await view(id)).access.poll_interval_sec).toBe(30);
  });

  it("设置了默认有效天数与轮询间隔：没给就用默认值", async () => {
    await saveSettings(cookie, "links", { ...DEFAULTS.links, default_expires_in_days: 7, default_poll_interval_sec: 60 });
    const before = nowSec();
    const { id } = await newLink();
    const expiresAt = (await linkRow(id)).expires_at as number;
    expect(expiresAt).toBeGreaterThanOrEqual(before + 7 * LINK_DEFAULT_EXPIRES_UNIT_SEC);
    expect(expiresAt).toBeLessThanOrEqual(nowSec() + 7 * LINK_DEFAULT_EXPIRES_UNIT_SEC);
    expect((await view(id)).access.poll_interval_sec).toBe(60);
  });

  it("显式给出的值优先：expires_at 给时间或 null、poll_interval_sec 给数值，都不被默认值覆盖", async () => {
    await saveSettings(cookie, "links", { ...DEFAULTS.links, default_expires_in_days: 7, default_poll_interval_sec: 60 });
    const fixed = nowSec() + 3600;
    const withValue = await newLink({ expires_at: fixed, access: { poll_interval_sec: 120 } });
    expect((await linkRow(withValue.id)).expires_at).toBe(fixed);
    expect((await view(withValue.id)).access.poll_interval_sec).toBe(120);
    const never = await newLink({ expires_at: null });
    expect((await linkRow(never.id)).expires_at).toBeNull();
  });

  it("设了未来的生效时间：默认有效期从生效时间起算，保证窗口合法", async () => {
    await saveSettings(cookie, "links", { ...DEFAULTS.links, default_expires_in_days: 2 });
    const validFrom = nowSec() + 10 * LINK_DEFAULT_EXPIRES_UNIT_SEC;
    const { id } = await newLink({ valid_from: validFrom });
    expect((await linkRow(id)).expires_at).toBe(validFrom + 2 * LINK_DEFAULT_EXPIRES_UNIT_SEC);
  });

  it("PATCH 的 access 不给轮询间隔：同样取系统默认值", async () => {
    await saveSettings(cookie, "links", { ...DEFAULTS.links, default_poll_interval_sec: 90 });
    const { id } = await newLink({ access: { poll_interval_sec: 20 } });
    const patched = await api(`/api/admin/links/${id}`, { cookie, method: "PATCH", json: { access: { max_devices: 2 } } });
    expect((await patched.json<AdminShareLink>()).access.poll_interval_sec).toBe(90);
  });
});
