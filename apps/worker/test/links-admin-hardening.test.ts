import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { LINK_ACCESS_LIMITS, SHARE_LINK_LIMITS, normalizeCidrText, type AdminShareLink, type ShareLinkCreateResponse } from "@maillink/shared";
import { LINK_INSERT_PAYLOAD_MAX_BYTES } from "../src/constants";
import { buildInsertPayload, updateShareLink, type NewShareLinkRow, type ShareLinkWrite } from "../src/db/share-link-writes";
import { createLinkToken, linkTokenKey } from "../src/links/token";
import { adminSession, api, auditRows, resetApp } from "./helpers";
import { createLink, createRuleGroup, importMailboxes, linkRow, publicApi, tableCounts, visitorCookie, type ErrorBody } from "./link-helpers";

// M3b-2 验收修复（管理端）：批量创建的参数字节预算、撤销终态竞态、rotate 清设备、映射地址 CIDR、口令 trim、批量 schema。

let cookie: string;
let groupId: number;
let mailboxId: number;

beforeEach(async () => {
  await resetApp();
  cookie = (await adminSession()).cookie;
  groupId = await createRuleGroup(cookie);
  mailboxId = (await importMailboxes(cookie, ["box@example.com"])).get("box@example.com") as number;
});

const D1_VALUE_MAX_BYTES = 2_000_000;
const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const MAX_CIDR = "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255/128";

function fullCommon(): ShareLinkWrite {
  const access = {
    password_hash: `pbkdf2-sha256$100000$${"A".repeat(24)}$${"B".repeat(44)}`,
    turnstile: false,
    max_devices: LINK_ACCESS_LIMITS.maxDevicesMax,
    reveal: "click",
    max_deliveries_total: LINK_ACCESS_LIMITS.deliveriesTotalMax,
    max_deliveries_per_day: LINK_ACCESS_LIMITS.deliveriesPerDayMax,
    ip_allow: Array.from({ length: LINK_ACCESS_LIMITS.ipAllowMax }, () => MAX_CIDR),
    country_allow: Array.from({ length: LINK_ACCESS_LIMITS.countryAllowMax }, () => "US"),
    poll_interval_sec: LINK_ACCESS_LIMITS.pollIntervalMaxSec,
  };
  return {
    name: "名".repeat(SHARE_LINK_LIMITS.nameMaxLength),
    order_ref: "单".repeat(SHARE_LINK_LIMITS.orderRefMaxLength),
    public_title: "题".repeat(SHARE_LINK_LIMITS.publicTitleMaxLength),
    public_note: "说".repeat(SHARE_LINK_LIMITS.publicNoteMaxLength),
    rule_group_id: Number.MAX_SAFE_INTEGER,
    status: "active",
    valid_from: 253_402_300_000,
    expires_at: 253_402_300_799,
    expire_after_first_access_sec: SHARE_LINK_LIMITS.durationMaxSec,
    access: JSON.stringify(access),
  };
}

describe("批量创建的参数字节预算（必修 5）", () => {
  it("字段全部填满 × 500：公共字段与逐行参数都在预算内（旧的每行重复公共字段会超过 D1 单值 2 MB）", async () => {
    const key = await linkTokenKey(env);
    const rows: NewShareLinkRow[] = [];
    for (let index = 0; index < SHARE_LINK_LIMITS.createMaxMailboxes; index += 1) {
      const { token: _token, ...columns } = await createLinkToken(key);
      rows.push({ ...columns, mailbox_ids: [Number.MAX_SAFE_INTEGER - index] });
    }
    const common = fullCommon();
    const payload = buildInsertPayload(common, rows);
    expect(utf8Bytes(payload.common)).toBeLessThan(LINK_INSERT_PAYLOAD_MAX_BYTES);
    expect(utf8Bytes(payload.rows)).toBeLessThan(LINK_INSERT_PAYLOAD_MAX_BYTES);
    expect(LINK_INSERT_PAYLOAD_MAX_BYTES).toBeLessThan(D1_VALUE_MAX_BYTES);
    const oldShape = JSON.stringify(rows.map((row) => ({ ...common, ...row })));
    expect(utf8Bytes(oldShape)).toBeGreaterThan(D1_VALUE_MAX_BYTES);
  });

  it("超过预算直接报错，不静默截断", () => {
    const rows = [{ token_hash: "h", token_enc: "e", token_hint: "x", mailbox_ids: [1] }];
    expect(() => buildInsertPayload({ ...fullCommon(), public_note: "x".repeat(LINK_INSERT_PAYLOAD_MAX_BYTES) }, rows)).toThrow(/超过上限/);
  });

  it("端到端：500 个地址、公开字段填满，一址一链全部建成", async () => {
    const addresses = Array.from({ length: SHARE_LINK_LIMITS.createMaxMailboxes }, (_, index) => `bulk${index}@example.com`);
    const boxes = await importMailboxes(cookie, addresses);
    const res = await api("/api/admin/links", {
      cookie,
      json: {
        mailbox_ids: addresses.map((address) => boxes.get(address) as number),
        rule_group_id: groupId,
        name: "名".repeat(SHARE_LINK_LIMITS.nameMaxLength),
        public_note: "说".repeat(SHARE_LINK_LIMITS.publicNoteMaxLength),
        access: { password: "open-sesame", ip_allow: Array.from({ length: LINK_ACCESS_LIMITS.ipAllowMax }, () => MAX_CIDR) },
      },
    });
    expect(res.status).toBe(201);
    expect((await res.json<ShareLinkCreateResponse>()).items).toHaveLength(SHARE_LINK_LIMITS.createMaxMailboxes);
    expect((await tableCounts()).share_links).toBe(SHARE_LINK_LIMITS.createMaxMailboxes);
  });
});

describe("撤销终态（必修 6）", () => {
  it("改成非 revoked 的条件更新不会覆盖已撤销的行（模拟读取后被并发撤销）", async () => {
    const { id } = await createLink(cookie, { mailbox_ids: [mailboxId], rule_group_id: groupId, status: "paused" });
    await env.APP_DB.prepare("UPDATE share_links SET status = 'revoked' WHERE id = ?").bind(id).run();
    expect(await updateShareLink(env.APP_DB, id, { status: "active" }, 1)).toBe(false);
    expect((await linkRow(id)).status).toBe("revoked");
    expect(await updateShareLink(env.APP_DB, id, { name: "改名仍可以" }, 1)).toBe(true);
    const res = await api(`/api/admin/links/${id}`, { method: "PATCH", cookie, json: { status: "active" } });
    expect(res.status).toBe(409);
    expect((await res.json<ErrorBody>()).error.code).toBe("link_revoked");
  });
});

describe("rotate、CIDR、口令、批量 schema（10、13、14）", () => {
  it("rotate 带 reset_devices：同时清空设备并记入审计", async () => {
    const { id, token } = await createLink(cookie, { mailbox_ids: [mailboxId], rule_group_id: groupId });
    visitorCookie(await publicApi(`/api/s/${token}/start`, {}, { json: {} }));
    expect((await tableCounts()).link_visitors).toBe(1);
    expect((await api(`/api/admin/links/${id}/rotate`, { cookie, json: { reset_devices: true } })).status).toBe(200);
    expect((await tableCounts()).link_visitors).toBe(0);
    expect(JSON.parse((await auditRows("link.token_rotate"))[0]?.detail ?? "{}")).toMatchObject({ reset_devices: true });
  });

  it("IPv4 映射地址的 CIDR 保存成 IPv4；前缀 < 96 的映射写法拒绝", async () => {
    expect(normalizeCidrText("::ffff:192.0.2.1")).toBe("192.0.2.1/32");
    expect(normalizeCidrText("::ffff:192.0.2.0/120")).toBe("192.0.2.0/24");
    expect(normalizeCidrText("::ffff:0:0/96")).toBe("0.0.0.0/0");
    expect(normalizeCidrText("::ffff:0:0/95")).toBeNull();
    expect(normalizeCidrText(" 2001:db8::/32 ")).toBe("2001:db8::/32");
    const res = await api("/api/admin/links", { cookie, json: { mailbox_ids: [mailboxId], rule_group_id: groupId, access: { ip_allow: ["::ffff:192.0.2.0/120"] } } });
    expect((await res.json<ShareLinkCreateResponse>()).items[0]?.link.access.ip_allow).toEqual(["192.0.2.0/24"]);
    const bad = await api("/api/admin/links", { cookie, json: { mailbox_ids: [mailboxId], rule_group_id: groupId, access: { ip_allow: ["::ffff:0:0/95"] } } });
    expect(bad.status).toBe(400);
  });

  it("口令 trim 后再检查长度；保存与开始取码口径一致", async () => {
    const short = await api("/api/admin/links", { cookie, json: { mailbox_ids: [mailboxId], rule_group_id: groupId, access: { password: "  ab  " } } });
    expect((await short.json<ErrorBody>()).error.code).toBe("validation_error");
    const { token } = await createLink(cookie, { mailbox_ids: [mailboxId], rule_group_id: groupId, access: { password: "  open-sesame  " } });
    expect((await publicApi(`/api/s/${token}/start`, {}, { json: { password: "open-sesame" } })).status).toBe(200);
  });

  it("批量 schema：按 action 区分必填字段", async () => {
    const { id } = await createLink(cookie, { mailbox_ids: [mailboxId], rule_group_id: groupId });
    const batch = (json: unknown) => api("/api/admin/links/batch", { cookie, json });
    for (const json of [{ ids: [id], action: "extend" }, { ids: [id], action: "set_rule_group" }, { ids: [id], action: "pause", extend_sec: 60 }, { ids: [id], action: "nope" }]) {
      expect((await batch(json)).status, JSON.stringify(json)).toBe(400);
    }
    expect((await batch({ ids: [id], action: "pause" })).status).toBe(200);
    expect(((await (await api(`/api/admin/links/${id}`, { cookie })).json()) as AdminShareLink).status).toBe("paused");
  });
});
