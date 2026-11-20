import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { LinkPublicStatus, ShareLinkCreate } from "@maillink/shared";
import { LINK_PASSWORD_MAX_FAILURES } from "../src/constants";
import { putMail } from "./access-helpers";
import { adminSession, api, resetApp } from "./helpers";
import { accessLogs, createLink, createRuleGroup, importMailboxes, linkRow, publicApi, tableCounts, visitorCookie, type ErrorBody } from "./link-helpers";

let cookie: string;
let groupId: number;
let mailboxId: number;
const nowSec = () => Math.floor(Date.now() / 1000);

beforeEach(async () => {
  await resetApp();
  cookie = (await adminSession()).cookie;
  groupId = await createRuleGroup(cookie);
  mailboxId = (await importMailboxes(cookie, ["box@example.com"])).get("box@example.com") as number;
});

const newLink = (extra: Partial<ShareLinkCreate> = {}) => createLink(cookie, { mailbox_ids: [mailboxId], rule_group_id: groupId, ...extra });
const setColumns = async (id: number, sql: string, ...values: unknown[]) =>
  env.APP_DB.prepare(`UPDATE share_links SET ${sql} WHERE id = ?`).bind(...values, id).run();
const start = (token: string, visitor = {}, json: unknown = {}) => publicApi(`/api/s/${token}/start`, visitor, { json });

describe("GET 无副作用", () => {
  it("未开始取码：状态页 needs_start，列表 / 详情要求开始取码；不登记设备、不写 first_access_at、不写日志", async () => {
    const mailId = await putMail({ address: "box@example.com", subject: "hi" });
    const { id, token } = await newLink({ public_title: "共享号", public_note: "联系 @seller" });
    const before = await tableCounts();
    const status = await publicApi(`/api/s/${token}`);
    expect(status.status).toBe(200);
    expect(await status.json<LinkPublicStatus>()).toMatchObject({
      state: "needs_start",
      activated: false,
      visitor_registered: false,
      requires_password: false,
      requires_turnstile: false,
      view: "text",
      reveal: "auto",
      mailboxes: ["box@example.com"],
      public_title: "共享号",
      public_note: "联系 @seller",
    });
    for (const path of [`/api/s/${token}/mails`, `/api/s/${token}/mails/${mailId}`, `/api/s/${token}/mails/${mailId}/attachments/0`]) {
      const res = await publicApi(path);
      expect(res.status, path).toBe(401);
      expect((await res.json<ErrorBody>()).error.code).toBe("link_start_required");
    }
    expect(await tableCounts()).toEqual(before);
    expect((await linkRow(id)).first_access_at).toBeNull();
  });

  it("公开响应头：no-store、no-referrer、noindex（错误响应同样）", async () => {
    const { token } = await newLink();
    for (const path of [`/api/s/${token}`, `/api/s/${"x".repeat(43)}`, "/api/s/short"]) {
      const res = await publicApi(path);
      expect(res.headers.get("Cache-Control"), path).toBe("no-store");
      expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    }
  });

  it("不存在：格式不对或查不到都是 404 link_not_found", async () => {
    for (const path of ["/api/s/short", `/api/s/${"A".repeat(43)}`, `/api/s/${"A".repeat(43)}/mails`]) {
      const res = await publicApi(path);
      expect(res.status).toBe(404);
      expect((await res.json<ErrorBody>()).error.code).toBe("link_not_found");
    }
  });
});

describe("POST /start", () => {
  it("登记设备、发 Cookie、写 first_access_at 与 start 日志；同一浏览器再点不重复登记", async () => {
    const { id, token } = await newLink({ expires_at: nowSec() + 600 });
    const res = await start(token);
    expect(res.status).toBe(200);
    expect(await res.json<LinkPublicStatus>()).toMatchObject({ state: "active", activated: true, visitor_registered: true });
    const line = res.headers.getSetCookie().find((value) => value.startsWith(`mlv_${id}=`)) ?? "";
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/Secure/);
    expect(line).toMatch(/SameSite=Lax/);
    expect(line).toMatch(/Path=\/api\/s\//);
    const maxAge = Number(/Max-Age=(\d+)/.exec(line)?.[1]);
    expect(maxAge).toBeGreaterThan(590);
    expect(maxAge).toBeLessThanOrEqual(600);
    const first = (await linkRow(id)).first_access_at;
    expect(first).not.toBeNull();
    const cookieValue = visitorCookie(res);
    const stored = await env.APP_DB.prepare("SELECT visitor_hash FROM link_visitors WHERE link_id = ?").bind(id).first<{ visitor_hash: string }>();
    expect(stored?.visitor_hash).not.toContain(cookieValue.split("=")[1] ?? "x");
    expect((await start(token, { cookie: cookieValue })).status).toBe(200);
    expect((await tableCounts()).link_visitors).toBe(1);
    expect((await linkRow(id)).first_access_at).toBe(first);
    expect((await accessLogs(id)).map((log) => log.event)).toEqual(["start"]);
    expect((await publicApi(`/api/s/${token}/mails`, { cookie: cookieValue })).status).toBe(200);
  });

  it("max_devices=1：首个访问者绑定；第二个访客 403 link_device_limit 并带 public_note，记日志", async () => {
    const { id, token } = await newLink({ access: { max_devices: 1 }, public_note: "换设备请联系客服" });
    const first = visitorCookie(await start(token));
    const second = await start(token);
    expect(second.status).toBe(403);
    expect((await second.json<ErrorBody>()).error).toMatchObject({ code: "link_device_limit", public_note: "换设备请联系客服" });
    expect((await accessLogs(id)).at(-1)).toMatchObject({ event: "denied", reason: "device_limit" });
    const status = await (await publicApi(`/api/s/${token}`)).json<LinkPublicStatus>();
    expect(status).toMatchObject({ state: "device_limit", public_note: "换设备请联系客服" });
    expect((await publicApi(`/api/s/${token}/mails`)).status).toBe(403);
    expect((await publicApi(`/api/s/${token}/mails`, { cookie: first })).status).toBe(200);
  });

  it("并发两个新访客抢 max_devices=1：只登记一个", async () => {
    const { token } = await newLink({ access: { max_devices: 1 } });
    const results = await Promise.all([start(token), start(token), start(token)]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 403, 403]);
    expect((await tableCounts()).link_visitors).toBe(1);
  });

  it("口令：缺失 400 不计次；错误 403 计次；错满后同一 IP 锁定（正确口令也拒），别的 IP 不受影响", async () => {
    const { id, token } = await newLink({ access: { password: "open-sesame" } });
    expect((await (await publicApi(`/api/s/${token}`)).json<LinkPublicStatus>()).requires_password).toBe(true);
    expect((await start(token)).status).toBe(400);
    for (let attempt = 0; attempt < LINK_PASSWORD_MAX_FAILURES; attempt += 1) {
      const res = await start(token, { ip: "198.51.100.1" }, { password: "wrong-pass" });
      expect((await res.json<ErrorBody>()).error.code).toBe("link_password_invalid");
    }
    const locked = await start(token, { ip: "198.51.100.1" }, { password: "open-sesame" });
    expect(locked.status).toBe(429);
    const body = await locked.json<ErrorBody>();
    expect(body.error.code).toBe("link_password_locked");
    expect(Number(body.error.retry_after_at)).toBeGreaterThan(nowSec());
    expect((await start(token, { ip: "198.51.100.2" }, { password: "open-sesame" })).status).toBe(200);
    const reasons = (await accessLogs(id)).map((log) => log.reason);
    expect(reasons.filter((reason) => reason === "bad_password")).toHaveLength(LINK_PASSWORD_MAX_FAILURES);
    expect(reasons).toContain("password_locked");
  });

  it("CSRF：缺 Origin 403", async () => {
    const { token } = await newLink();
    const res = await api(`/api/s/${token}/start`, { json: {}, origin: false });
    expect(res.status).toBe(403);
    expect((await tableCounts()).link_visitors).toBe(0);
  });
});

describe("检查顺序与对外错误", () => {
  type Case = { name: string; setup: (id: number) => Promise<unknown>; visitor?: { ip?: string; country?: string }; reason: string };
  const unavailableCases: Case[] = [
    { name: "撤销", setup: (id) => setColumns(id, "status = 'revoked'"), reason: "revoked" },
    { name: "暂停", setup: (id) => setColumns(id, "status = 'paused'"), reason: "paused" },
    { name: "过期", setup: (id) => setColumns(id, "expires_at = ?", nowSec() - 1), reason: "expired" },
    {
      name: "首次访问后过期",
      setup: (id) => setColumns(id, "first_access_at = ?, expire_after_first_access_sec = 60", nowSec() - 61),
      reason: "expired_after_first_access",
    },
    { name: "IP 不在白名单", setup: (id) => setColumns(id, "access = json_set(access, '$.ip_allow', json('[\"10.0.0.0/8\"]'))"), reason: "ip_denied" },
    {
      name: "国家不在白名单",
      setup: (id) => setColumns(id, "access = json_set(access, '$.country_allow', json('[\"JP\"]'))"),
      visitor: { country: "US" },
      reason: "country_denied",
    },
    {
      name: "撤销优先于 IP",
      setup: (id) => setColumns(id, "status = 'revoked', access = json_set(access, '$.ip_allow', json('[\"10.0.0.0/8\"]'))"),
      reason: "revoked",
    },
    { name: "过期优先于未生效", setup: (id) => setColumns(id, "valid_from = ?, expires_at = ?", nowSec() + 100, nowSec() - 1), reason: "expired" },
  ];

  it("撤销 / 暂停 / 过期 / IP / 国家：对外同一个 410 link_unavailable（同文案），日志里是具体原因；GET 不写日志", async () => {
    const bodies = new Set<string>();
    for (const testCase of unavailableCases) {
      const { id, token } = await newLink();
      await testCase.setup(id);
      const getRes = await publicApi(`/api/s/${token}`, testCase.visitor);
      expect(getRes.status, testCase.name).toBe(410);
      bodies.add(await getRes.text());
      expect(await accessLogs(id), testCase.name).toEqual([]);
      const res = await start(token, testCase.visitor);
      expect(res.status, testCase.name).toBe(410);
      bodies.add(await res.text());
      expect(await accessLogs(id), testCase.name).toEqual([{ event: "denied", reason: testCase.reason, mail_id: null }]);
    }
    expect(bodies.size).toBe(1);
    expect(JSON.parse([...bodies][0] ?? "{}")).toEqual({ error: { code: "link_unavailable", message: "链接已失效" } });
  });

  it("未到生效时间：403 link_not_yet_valid 带 valid_from", async () => {
    const validFrom = nowSec() + 3600;
    const { id, token } = await newLink({ valid_from: validFrom });
    const res = await start(token);
    expect(res.status).toBe(403);
    expect((await res.json<ErrorBody>()).error).toMatchObject({ code: "link_not_yet_valid", valid_from: validFrom });
    expect(await accessLogs(id)).toEqual([{ event: "denied", reason: "not_yet_valid", mail_id: null }]);
  });

  it("IP 白名单：IPv4 / IPv6 CIDR 与 IPv4 映射地址；国家白名单取 request.cf.country", async () => {
    const { token } = await newLink({ access: { ip_allow: ["192.0.2.0/24", "2001:db8::/32"], country_allow: ["US"] } });
    const allowed = [
      { ip: "192.0.2.9", country: "US" },
      { ip: "2001:db8:1::5", country: "US" },
      { ip: "::ffff:192.0.2.10", country: "us" },
    ];
    for (const visitor of allowed) expect((await publicApi(`/api/s/${token}`, visitor)).status, visitor.ip).toBe(200);
    const denied = [{ ip: "192.0.3.1", country: "US" }, { ip: "2001:db9::1", country: "US" }, { ip: "192.0.2.9" }, { ip: "192.0.2.9", country: "CN" }];
    for (const visitor of denied) expect((await publicApi(`/api/s/${token}`, visitor)).status, JSON.stringify(visitor)).toBe(410);
  });

  it("首次访问后过期：start 后 Cookie 有效期不超过剩余时间", async () => {
    const { token } = await newLink({ expire_after_first_access_sec: 120 });
    const status = await (await publicApi(`/api/s/${token}`)).json<LinkPublicStatus>();
    expect(status).toMatchObject({ expires_at: null, expire_after_first_access_sec: 120 });
    const res = await start(token);
    const line = res.headers.getSetCookie().find((value) => value.startsWith("mlv_")) ?? "";
    expect(Number(/Max-Age=(\d+)/.exec(line)?.[1])).toBeLessThanOrEqual(120);
    const after = await res.json<LinkPublicStatus>();
    expect(after.expires_at).toBeGreaterThan(nowSec() + 100);
    expect(after.expire_after_first_access_sec).toBeNull();
  });
});

describe("收件地址被删除 / 停用", () => {
  it("链接下没有可用地址：状态 no_mailbox，列表 409 link_no_mailbox", async () => {
    const { token } = await newLink();
    const visitor = visitorCookie(await start(token));
    await api(`/api/admin/mailboxes/${mailboxId}`, { method: "DELETE", cookie });
    const status = await (await publicApi(`/api/s/${token}`, { cookie: visitor })).json<LinkPublicStatus>();
    expect(status).toMatchObject({ state: "no_mailbox", mailbox_count: 0, mailboxes: [] });
    const res = await publicApi(`/api/s/${token}/mails`, { cookie: visitor });
    expect(res.status).toBe(409);
    expect((await res.json<ErrorBody>()).error.code).toBe("link_no_mailbox");
  });

  it("停用的地址不对外提供邮件", async () => {
    const { token } = await newLink();
    await env.APP_DB.prepare("UPDATE mailboxes SET status = 'disabled' WHERE id = ?").bind(mailboxId).run();
    expect((await (await publicApi(`/api/s/${token}`)).json<LinkPublicStatus>()).state).toBe("no_mailbox");
  });

  it("recipient=masked 时状态页打码", async () => {
    const masked = await createRuleGroup(cookie, {
      schema_version: 1,
      time: { since: { type: "none" } },
      filter: { mode: "blacklist", rules: [] },
      present: { view: "text", sender: "full", recipient: "masked", snippet: true, links: "keep", remote_images: "block", attachments: "list", redact: [], extract: ["code"] },
      limits: {},
    });
    const { token } = await createLink(cookie, { mailbox_ids: [mailboxId], rule_group_id: masked });
    expect((await (await publicApi(`/api/s/${token}`)).json<LinkPublicStatus>()).mailboxes).toEqual(["b***@example.com"]);
  });
});

describe("限流（LINK_RATE_LIMITER）", () => {
  const denyAll: RateLimit = { limit: async () => ({ success: false }) };
  function recording(): { limiter: RateLimit; keys: string[] } {
    const keys: string[] = [];
    return { keys, limiter: { limit: async ({ key }) => (keys.push(key), { success: true }) } };
  }

  it("超限：GET 与 POST 都 429 rate_limited 带 Retry-After，start 不登记设备、不写日志", async () => {
    const { id, token } = await newLink();
    const bindings = { LINK_RATE_LIMITER: denyAll };
    const status = await publicApi(`/api/s/${token}`, {}, { bindings });
    expect(status.status).toBe(429);
    expect(status.headers.get("Retry-After")).toBe("60");
    expect(status.headers.get("Cache-Control")).toBe("no-store");
    expect((await status.json<ErrorBody>()).error.code).toBe("rate_limited");
    const res = await publicApi(`/api/s/${token}/start`, {}, { json: {}, bindings });
    expect(res.status).toBe(429);
    expect((await tableCounts()).link_visitors).toBe(0);
    expect(await accessLogs(id)).toEqual([]);
    expect((await linkRow(id)).first_access_at).toBeNull();
  });

  it("缺 binding：503 rate_limiter_not_configured（不静默放行）", async () => {
    const { token } = await newLink();
    const res = await publicApi(`/api/s/${token}`, {}, { bindings: { LINK_RATE_LIMITER: undefined } });
    expect(res.status).toBe(503);
    expect((await res.json<ErrorBody>()).error.code).toBe("rate_limiter_not_configured");
  });

  it("位置：在状态 / 过期 / IP 检查之后（这些先拒绝且不消耗限流），按 token_hash + IP 计", async () => {
    const revoked = await newLink();
    await setColumns(revoked.id, "status = 'revoked'");
    const ipDenied = await newLink({ access: { ip_allow: ["10.0.0.0/8"] } });
    const counter = recording();
    expect((await publicApi(`/api/s/${revoked.token}`, {}, { bindings: { LINK_RATE_LIMITER: counter.limiter } })).status).toBe(410);
    expect((await publicApi(`/api/s/${ipDenied.token}`, {}, { bindings: { LINK_RATE_LIMITER: counter.limiter } })).status).toBe(410);
    expect((await publicApi("/api/s/short", {}, { bindings: { LINK_RATE_LIMITER: counter.limiter } })).status).toBe(404);
    expect(counter.keys).toEqual([]);
    const ok = await newLink();
    expect((await publicApi(`/api/s/${ok.token}/mails`, { ip: "198.51.100.9" }, { bindings: { LINK_RATE_LIMITER: counter.limiter } })).status).toBe(401);
    expect(counter.keys).toEqual([`link:${String((await linkRow(ok.id)).token_hash)}:198.51.100.9`]);
  });

  it("管理员预览不经过限流：缺 LINK_RATE_LIMITER 时仍 200", async () => {
    const { id } = await newLink();
    const res = await api(`/api/admin/links/${id}/preview`, { cookie, bindings: { LINK_RATE_LIMITER: undefined } });
    expect(res.status).toBe(200);
  });
});
