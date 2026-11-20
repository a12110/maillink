import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  LINK_ACCESS_LIMITS,
  SHARE_LINK_LIMITS,
  type AdminShareLink,
  type ShareLinkBatchResponse,
  type ShareLinkExportResponse,
  type ShareLinkListResponse,
  type ShareLinkToken,
} from "@maillink/shared";
import { sha256Hex } from "../src/auth/crypto";
import { LINK_POLL_MIN_SEC, MAX_MAILBOXES_PER_LINK } from "../src/constants";
import { decryptLinkToken, linkTokenKey } from "../src/links/token";
import { adminSession, api, auditRows, resetApp } from "./helpers";
import { createLink, createLinks, createRuleGroup, importMailboxes, linkRow, type ErrorBody } from "./link-helpers";

let cookie: string;
let groupId: number;
let boxes: Map<string, number>;
const box = (address: string) => boxes.get(address) as number;

beforeEach(async () => {
  await resetApp();
  cookie = (await adminSession()).cookie;
  groupId = await createRuleGroup(cookie);
  boxes = await importMailboxes(cookie, ["a@example.com", "b@example.com", "c@example.com"]);
});

async function errorOf(res: Response): Promise<{ status: number; code: string }> {
  return { status: res.status, code: (await res.json<ErrorBody>()).error.code };
}

describe("共享上限与 worker 常量一致", () => {
  it("poll 最小值与单链接地址上限", () => {
    expect(LINK_ACCESS_LIMITS.pollIntervalMinSec).toBe(LINK_POLL_MIN_SEC);
    expect(SHARE_LINK_LIMITS.mailboxesPerLink).toBe(MAX_MAILBOXES_PER_LINK);
  });

  it("迁移 0006 建了访问日志的时间索引", async () => {
    const row = await env.APP_DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_lal_link_time'").first();
    expect(row).not.toBeNull();
  });
});

describe("POST /api/admin/links", () => {
  it("一址一链：每个地址一个链接，完整 token 只在创建响应里；库里只存哈希、密文与前 6 位", async () => {
    const created = await createLinks(cookie, { mailbox_ids: [box("a@example.com"), box("b@example.com")], rule_group_id: groupId });
    expect(created.items).toHaveLength(2);
    for (const item of created.items) {
      expect(item.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(item.url).toBe(`${env.PUBLIC_ORIGIN}/s/${item.token}`);
      expect(item.link.token_hint).toBe(item.token.slice(0, 6));
      expect(item.link.mailboxes).toHaveLength(1);
      const row = await linkRow(item.link.id);
      expect(row.token_hash).toBe(await sha256Hex(item.token));
      expect(String(row.token_enc)).not.toContain(item.token);
      expect(await decryptLinkToken(await linkTokenKey(env), String(row.token_enc), String(row.token_hash))).toBe(item.token);
    }
    const list = await (await api("/api/admin/links", { cookie })).text();
    for (const item of created.items) expect(list).not.toContain(item.token);
    const audit = await auditRows("link.create");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.detail).not.toContain(created.items[0]?.token ?? "x");
  });

  it("一链多址：一个链接绑定多个地址；超过 50 个 400", async () => {
    const created = await createLinks(cookie, { mode: "combined", mailbox_ids: [...boxes.values()], rule_group_id: groupId });
    expect(created.items).toHaveLength(1);
    expect(created.items[0]?.link.mailboxes.map((m) => m.address).sort()).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
    const tooMany = Array.from({ length: 51 }, (_, index) => index + 1000);
    const res = await api("/api/admin/links", { cookie, json: { mode: "combined", mailbox_ids: tooMany, rule_group_id: groupId } });
    expect(res.status).toBe(400);
  });

  it("地址已有生效链接时给出提示，不阻止", async () => {
    await createLink(cookie, { mailbox_ids: [box("a@example.com")], rule_group_id: groupId });
    const again = await createLinks(cookie, { mailbox_ids: [box("a@example.com")], rule_group_id: groupId });
    expect(again.warnings).toEqual([{ mailbox_id: box("a@example.com"), address: "a@example.com", active_link_count: 1 }]);
  });

  it("设了取码上限却用 auto：400 reveal_must_be_click；click 可保存", async () => {
    for (const access of [{ max_deliveries_total: 3 }, { max_deliveries_per_day: 1, reveal: "auto" as const }]) {
      const res = await api("/api/admin/links", { cookie, json: { mailbox_ids: [box("a@example.com")], rule_group_id: groupId, access } });
      expect(await errorOf(res)).toEqual({ status: 400, code: "reveal_must_be_click" });
    }
    const ok = await createLink(cookie, { mailbox_ids: [box("a@example.com")], rule_group_id: groupId, access: { reveal: "click", max_deliveries_total: 3 } });
    expect(ok.id).toBeGreaterThan(0);
  });

  it("turnstile=true：400 turnstile_not_configured（M6 之前不假装校验）", async () => {
    const res = await api("/api/admin/links", { cookie, json: { mailbox_ids: [box("a@example.com")], rule_group_id: groupId, access: { turnstile: true } } });
    expect(await errorOf(res)).toEqual({ status: 400, code: "turnstile_not_configured" });
  });

  it("CIDR、国家代码、轮询间隔校验", async () => {
    const bad = [
      { ip_allow: ["10.0.0.256/8"] },
      { ip_allow: ["10.0.0.0/33"] },
      { ip_allow: ["2001:db8::1::/64"] },
      { country_allow: ["UK"] },
      { poll_interval_sec: LINK_POLL_MIN_SEC - 1 },
    ];
    for (const access of bad) {
      const res = await api("/api/admin/links", { cookie, json: { mailbox_ids: [box("a@example.com")], rule_group_id: groupId, access } });
      expect((await errorOf(res)).code, JSON.stringify(access)).toBe("validation_error");
    }
    const ok = await createLinks(cookie, {
      mailbox_ids: [box("a@example.com")],
      rule_group_id: groupId,
      access: { ip_allow: ["10.0.0.0/8", "2001:db8::/32", "::ffff:192.0.2.1"], country_allow: ["us", "CN"] },
    });
    expect(ok.items[0]?.link.access.country_allow).toEqual(["US", "CN"]);
    expect(ok.items[0]?.link.access.ip_allow).toEqual(["10.0.0.0/8", "2001:db8::/32", "192.0.2.1/32"]);
  });

  it("收件地址或规则组不存在：400", async () => {
    expect((await errorOf(await api("/api/admin/links", { cookie, json: { mailbox_ids: [9999], rule_group_id: groupId } }))).code).toBe("mailbox_not_found");
    expect((await errorOf(await api("/api/admin/links", { cookie, json: { mailbox_ids: [box("a@example.com")], rule_group_id: 9999 } }))).code).toBe(
      "rule_group_not_found",
    );
  });
});

describe("token、修改、删除", () => {
  it("GET /:id/token 取回完整链接并写审计", async () => {
    const { id, token } = await createLink(cookie, { mailbox_ids: [box("a@example.com")], rule_group_id: groupId });
    const body = await (await api(`/api/admin/links/${id}/token`, { cookie })).json<ShareLinkToken>();
    expect(body).toEqual({ token, url: `${env.PUBLIC_ORIGIN}/s/${token}` });
    const audit = await auditRows("link.token_view");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.detail).not.toContain(token);
  });

  it("口令：只存哈希；PATCH 不给口令保留原值，null 清除", async () => {
    const { id } = await createLink(cookie, { mailbox_ids: [box("a@example.com")], rule_group_id: groupId, access: { password: "open-sesame" } });
    const stored = String((await linkRow(id)).access);
    expect(stored).not.toContain("open-sesame");
    expect(stored).toContain("pbkdf2-sha256$");
    const patch = (access: unknown) => api(`/api/admin/links/${id}`, { method: "PATCH", cookie, json: { access } });
    expect((await (await patch({ max_devices: 2 })).json<AdminShareLink>()).access).toMatchObject({ has_password: true, max_devices: 2 });
    expect((await (await patch({ password: null })).json<AdminShareLink>()).access.has_password).toBe(false);
  });

  it("撤销后不能恢复（409），撤销写审计", async () => {
    const { id } = await createLink(cookie, { mailbox_ids: [box("a@example.com")], rule_group_id: groupId });
    const revoke = await api(`/api/admin/links/${id}`, { method: "PATCH", cookie, json: { status: "revoked" } });
    expect((await revoke.json<AdminShareLink>()).state).toBe("revoked");
    expect(await auditRows("link.revoke")).toHaveLength(1);
    const res = await api(`/api/admin/links/${id}`, { method: "PATCH", cookie, json: { status: "active" } });
    expect(await errorOf(res)).toEqual({ status: 409, code: "link_revoked" });
  });

  it("PATCH 合并后 valid_from 必须早于 expires_at", async () => {
    const { id } = await createLink(cookie, { mailbox_ids: [box("a@example.com")], rule_group_id: groupId, expires_at: 2_000_000_000 });
    const res = await api(`/api/admin/links/${id}`, { method: "PATCH", cookie, json: { valid_from: 2_000_000_001 } });
    expect((await errorOf(res)).code).toBe("validation_error");
  });

  it("DELETE 删除链接并级联清理，写审计", async () => {
    const { id } = await createLink(cookie, { mailbox_ids: [box("a@example.com")], rule_group_id: groupId });
    expect((await api(`/api/admin/links/${id}`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await api(`/api/admin/links/${id}`, { cookie })).status).toBe(404);
    const left = await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM share_link_mailboxes").first<{ n: number }>();
    expect(left?.n).toBe(0);
    expect(await auditRows("link.delete")).toHaveLength(1);
  });
});

describe("GET /api/admin/links 列表与筛选", () => {
  it("按状态、订单号、收件地址、关键词筛选，带 total 与游标", async () => {
    const a = await createLink(cookie, { mailbox_ids: [box("a@example.com")], rule_group_id: groupId, order_ref: "ORDER-123" });
    const b = await createLink(cookie, { mailbox_ids: [box("b@example.com")], rule_group_id: groupId, expires_at: 1000, valid_from: 10 });
    const c = await createLink(cookie, { mailbox_ids: [box("c@example.com")], rule_group_id: groupId, status: "paused", name: "Netflix 共享" });
    const list = async (query: string) => (await api(`/api/admin/links${query}`, { cookie })).json<ShareLinkListResponse>();
    const ids = async (query: string) => (await list(query)).items.map((item) => item.id);
    expect(await ids("?state=expired")).toEqual([b.id]);
    expect(await ids("?state=paused")).toEqual([c.id]);
    expect(await ids("?state=active")).toEqual([a.id]);
    expect(await ids("?order_ref=order-1")).toEqual([a.id]);
    expect(await ids(`?mailbox_id=${box("b@example.com")}`)).toEqual([b.id]);
    expect(await ids("?q=netflix")).toEqual([c.id]);
    expect(await ids("?q=c%40example")).toEqual([c.id]);
    const page = await list("?limit=2");
    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.id)).toEqual([c.id, b.id]);
    expect((await list(`?limit=2&cursor=${page.next_cursor}`)).items.map((item) => item.id)).toEqual([a.id]);
  });

  it("异常标记：设备数达上限、国家数 ≥ 2", async () => {
    const { id } = await createLink(cookie, { mailbox_ids: [box("a@example.com")], rule_group_id: groupId, access: { max_devices: 2 } });
    await env.APP_DB.batch([
      env.APP_DB.prepare("INSERT INTO link_visitors VALUES (?, 'h1', 1, 1, NULL, 'US', NULL)").bind(id),
      env.APP_DB.prepare("INSERT INTO link_visitors VALUES (?, 'h2', 1, 1, NULL, 'CN', NULL)").bind(id),
    ]);
    const link = await (await api(`/api/admin/links/${id}`, { cookie })).json<AdminShareLink>();
    expect(link).toMatchObject({ device_count: 2, country_count: 2, anomalies: ["device_limit_reached", "multi_country"] });
  });
});

describe("POST /api/admin/links/batch", () => {
  it("暂停 / 恢复 / 撤销 / 延长 / 换规则组，逐条结果", async () => {
    const a = await createLink(cookie, { mailbox_ids: [box("a@example.com")], rule_group_id: groupId, expires_at: 1000 });
    const b = await createLink(cookie, { mailbox_ids: [box("b@example.com")], rule_group_id: groupId });
    const batch = async (json: unknown) => (await api("/api/admin/links/batch", { cookie, json })).json<ShareLinkBatchResponse>();
    expect((await batch({ ids: [a.id, b.id, 9999], action: "pause" })).results).toEqual([
      { id: a.id, ok: true },
      { id: b.id, ok: true },
      { id: 9999, ok: false, error: "not_found" },
    ]);
    expect((await batch({ ids: [a.id], action: "pause" })).results[0]).toEqual({ id: a.id, ok: false, error: "not_active" });
    expect((await batch({ ids: [a.id, b.id], action: "resume" })).results.every((r) => r.ok)).toBe(true);
    const before = Math.floor(Date.now() / 1000);
    expect((await batch({ ids: [a.id, b.id], action: "extend", extend_sec: 3600 })).results).toEqual([
      { id: a.id, ok: true },
      { id: b.id, ok: false, error: "no_deadline" },
    ]);
    expect(Number((await linkRow(a.id)).expires_at)).toBeGreaterThanOrEqual(before + 3600);
    const other = await createRuleGroup(cookie);
    expect((await batch({ ids: [b.id], action: "set_rule_group", rule_group_id: other })).results[0]?.ok).toBe(true);
    expect((await linkRow(b.id)).rule_group_id).toBe(other);
    expect((await batch({ ids: [b.id], action: "revoke" })).results[0]?.ok).toBe(true);
    expect((await batch({ ids: [b.id], action: "resume" })).results[0]).toEqual({ id: b.id, ok: false, error: "link_revoked" });
    expect((await auditRows("link.batch")).length).toBe(7);
  });
});

describe("POST /api/admin/links/export", () => {
  it("CSV：address,note,link；公式开头的值加单引号；含逗号引号的值加引号", async () => {
    await env.APP_DB.prepare("UPDATE mailboxes SET note = ? WHERE id = ?").bind('=HYPERLINK("x"),1', box("a@example.com")).run();
    const { id, token } = await createLink(cookie, { mailbox_ids: [box("a@example.com")], rule_group_id: groupId });
    const res = await api("/api/admin/links/export", { cookie, json: { ids: [id] } });
    const body = await res.json<ShareLinkExportResponse>();
    expect(body.content).toBe(`address,note,link\r\na@example.com,"'=HYPERLINK(""x""),1",${env.PUBLIC_ORIGIN}/s/${token}\r\n`);
    expect(await auditRows("link.export")).toHaveLength(1);
  });

  it("行模板：变量白名单、值里的换行换成空格；不加公式前缀（-foo@x.com 不被改坏）", async () => {
    const dash = (await importMailboxes(cookie, ["-foo@x.com"])).get("-foo@x.com") as number;
    const dashLink = await createLink(cookie, { mailbox_ids: [dash], rule_group_id: groupId });
    const dashRes = await api("/api/admin/links/export", { cookie, json: { ids: [dashLink.id], format: "template", template: "{address}----{link}" } });
    expect((await dashRes.json<ShareLinkExportResponse>()).content).toBe(`-foo@x.com----${env.PUBLIC_ORIGIN}/s/${dashLink.token}\n`);
    const { id, token } = await createLink(cookie, { mailbox_ids: [box("b@example.com")], rule_group_id: groupId, order_ref: "@cmd\nx" });
    const res = await api("/api/admin/links/export", { cookie, json: { ids: [id], format: "template", template: "{address}----{link}----{order_ref}" } });
    expect((await res.json<ShareLinkExportResponse>()).content).toBe(`b@example.com----${env.PUBLIC_ORIGIN}/s/${token}----@cmd x\n`);
    const bad = await api("/api/admin/links/export", { cookie, json: { ids: [id], format: "template", template: "{address}:{token}" } });
    expect(await errorOf(bad)).toEqual({ status: 400, code: "template_invalid" });
    const multiline = await api("/api/admin/links/export", { cookie, json: { ids: [id], format: "template", template: "{address}\n{link}" } });
    expect((await errorOf(multiline)).code).toBe("template_invalid");
  });
});
