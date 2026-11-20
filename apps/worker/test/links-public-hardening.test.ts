import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { LinkPublicStatus, ShareLinkCreate } from "@maillink/shared";
import { LINK_PASSWORD_MAX_FAILURES, LINK_PASSWORD_MAX_FAILURES_PER_LINK } from "../src/constants";
import { passwordIpBucket } from "../src/db/link-password";
import { putMail } from "./access-helpers";
import { adminSession, api, resetApp } from "./helpers";
import { accessLogs, createLink, createRuleGroup, importMailboxes, publicApi, tableCounts, visitorCookie, type ErrorBody } from "./link-helpers";

// M3b-2 验收修复：口令并发锁定、按链接全局上限、被拒写请求先限流、口令前不给地址、续期重发 Cookie、CSRF 拒绝带安全头。

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
const start = (token: string, visitor = {}, json: unknown = {}) => publicApi(`/api/s/${token}/start`, visitor, { json });
const attemptRows = async () => (await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM link_password_attempts").first<{ n: number }>())?.n ?? 0;
const maxAgeOf = (res: Response) => Number(/Max-Age=(\d+)/.exec(res.headers.getSetCookie().find((line) => line.startsWith("mlv_")) ?? "")?.[1]);

describe("口令锁定（必修 1、2）", () => {
  it("并发 20 次错口令：只有进行中上限个进入 PBKDF2（403），其余 429（link_password_busy 或已锁定，迁移 0011）", async () => {
    const { token } = await newLink({ access: { password: "open-sesame" } });
    const results = await Promise.all(Array.from({ length: 20 }, () => start(token, { ip: "198.51.100.1" }, { password: "wrong-pass" })));
    const statuses = results.map((res) => res.status);
    expect(statuses.filter((status) => status === 403)).toHaveLength(LINK_PASSWORD_MAX_FAILURES);
    expect(statuses.filter((status) => status === 429)).toHaveLength(20 - LINK_PASSWORD_MAX_FAILURES);
    expect(await attemptRows()).toBe(LINK_PASSWORD_MAX_FAILURES);
  });

  it("口令正确时释放占位，不计入失败", async () => {
    const { token } = await newLink({ access: { password: "open-sesame" } });
    await start(token, { ip: "198.51.100.1" }, { password: "wrong-pass" });
    expect((await start(token, { ip: "198.51.100.1" }, { password: "open-sesame" })).status).toBe(200);
    expect(await attemptRows()).toBe(1);
  });

  it("按链接的全局上限：累计错满后所有新设备锁定（换 IP、正确口令也不行），已登记设备不受影响", async () => {
    const { id, token } = await newLink({ access: { password: "open-sesame" } });
    const registered = visitorCookie(await start(token, { ip: "192.0.2.200" }, { password: "open-sesame" }));
    const ips = Math.ceil(LINK_PASSWORD_MAX_FAILURES_PER_LINK / LINK_PASSWORD_MAX_FAILURES);
    for (let ip = 0; ip < ips; ip += 1) {
      for (let attempt = 0; attempt < LINK_PASSWORD_MAX_FAILURES; attempt += 1) {
        await start(token, { ip: `198.51.100.${ip + 1}` }, { password: "wrong-pass" });
      }
    }
    const locked = await start(token, { ip: "203.0.113.50" }, { password: "open-sesame" });
    expect(locked.status).toBe(429);
    expect((await locked.json<ErrorBody>()).error.code).toBe("link_password_locked");
    expect((await start(token, { ip: "203.0.113.50", cookie: registered })).status).toBe(200);
    expect((await accessLogs(id)).filter((log) => log.reason === "bad_password")).toHaveLength(LINK_PASSWORD_MAX_FAILURES_PER_LINK);
  });

  it("IPv6 按 /64 合并计数：同一 /64 换地址仍锁定，相邻 /64 不受影响", async () => {
    const { token } = await newLink({ access: { password: "open-sesame" } });
    for (let index = 1; index <= LINK_PASSWORD_MAX_FAILURES; index += 1) {
      await start(token, { ip: `2001:db8:1:2::${index}` }, { password: "wrong-pass" });
    }
    expect((await start(token, { ip: "2001:db8:1:2:ffff::9" }, { password: "open-sesame" })).status).toBe(429);
    expect((await start(token, { ip: "2001:db8:1:3::1" }, { password: "open-sesame" })).status).toBe(200);
    expect(passwordIpBucket("2001:db8:1:2::1")).toBe(passwordIpBucket("2001:0db8:0001:0002:ffff::"));
    expect(passwordIpBucket("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(passwordIpBucket(null)).toBe("unknown");
  });
});

describe("被拒的写请求先限流再写日志（必修 3）", () => {
  it("已撤销链接的 POST：每次都经过限流；被限流时不写日志", async () => {
    const { id, token } = await newLink();
    await env.APP_DB.prepare("UPDATE share_links SET status = 'revoked' WHERE id = ?").bind(id).run();
    const keys: string[] = [];
    const recording: RateLimit = { limit: async ({ key }) => (keys.push(key), { success: true }) };
    for (let index = 0; index < 3; index += 1) {
      expect((await publicApi(`/api/s/${token}/start`, {}, { json: {}, bindings: { LINK_RATE_LIMITER: recording } })).status).toBe(410);
    }
    expect(keys).toHaveLength(3);
    expect(await accessLogs(id)).toHaveLength(3);
    const denyAll: RateLimit = { limit: async () => ({ success: false }) };
    const res = await publicApi(`/api/s/${token}/start`, {}, { json: {}, bindings: { LINK_RATE_LIMITER: denyAll } });
    expect(res.status).toBe(429);
    expect(await accessLogs(id)).toHaveLength(3);
  });

  it("IP 被拒、未生效的 POST 同样先限流", async () => {
    const ipDenied = await newLink({ access: { ip_allow: ["10.0.0.0/8"] } });
    const pending = await newLink({ valid_from: nowSec() + 3600 });
    const denyAll: RateLimit = { limit: async () => ({ success: false }) };
    for (const link of [ipDenied, pending]) {
      expect((await publicApi(`/api/s/${link.token}/start`, {}, { json: {}, bindings: { LINK_RATE_LIMITER: denyAll } })).status).toBe(429);
      expect(await accessLogs(link.id)).toEqual([]);
    }
  });
});

describe("口令前不给收件地址（必修 4）", () => {
  it("设了口令：未登记时 mailboxes 为空、保留 mailbox_count；口令通过后给出", async () => {
    const { token } = await newLink({ access: { password: "open-sesame" } });
    const before = await (await publicApi(`/api/s/${token}`)).json<LinkPublicStatus>();
    expect(before).toMatchObject({ requires_password: true, mailboxes: [], mailbox_count: 1 });
    const res = await start(token, {}, { password: "open-sesame" });
    expect((await res.json<LinkPublicStatus>()).mailboxes).toEqual(["box@example.com"]);
    const after = await (await publicApi(`/api/s/${token}`, { cookie: visitorCookie(res) })).json<LinkPublicStatus>();
    expect(after.mailboxes).toEqual(["box@example.com"]);
  });
});

describe("Cookie 续期与安全头（7、8）", () => {
  it("续费后已登记访客再 start / reveal 时按新的剩余有效期重发 Cookie", async () => {
    const mailId = await putMail({ address: "box@example.com", text: "Your verification code is 123456" });
    const { id, token } = await newLink({ expires_at: nowSec() + 600, access: { reveal: "click" } });
    const first = await start(token);
    expect(maxAgeOf(first)).toBeLessThanOrEqual(600);
    const visitor = visitorCookie(first);
    await api("/api/admin/links/batch", { cookie, json: { ids: [id], action: "extend", extend_sec: 7200 } });
    const again = await start(token, { cookie: visitor });
    expect(visitorCookie(again)).toBe(visitor);
    expect(maxAgeOf(again)).toBeGreaterThan(7000);
    const revealed = await publicApi(`/api/s/${token}/mails/${mailId}/reveal`, { cookie: visitor }, { json: {} });
    expect(revealed.status).toBe(200);
    expect(maxAgeOf(revealed)).toBeGreaterThan(7000);
  });

  it("CSRF 拒绝的公开写请求也带 no-store / no-referrer / noindex", async () => {
    const { token } = await newLink();
    const res = await api(`/api/s/${token}/start`, { json: {}, origin: false });
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect((await tableCounts()).link_visitors).toBe(0);
  });
});
