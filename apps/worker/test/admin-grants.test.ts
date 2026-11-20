import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GRANT_BATCH_MAX_PAIRS,
  type AdminGrant,
  type AdminGrantListResponse,
  type AdminUser,
  type GrantBatchResponse,
} from "@maillink/shared";
import { nowSec } from "../src/clock";
import { adminSession, api, auditRows, createSessionCookie, createUser, resetApp } from "./helpers";
import { grantRow, insertGrant, insertMailbox, insertRuleGroup } from "./grants-helpers";

// 管理端授权（04 管理端 / 授权，03 §6）。

type ErrorBody = { error: { code: string; message: string } };

let cookie = "";
let adminId = 0;
let alice = 0;
let bob = 0;
let boxA = 0;
let boxB = 0;
let group = 0;

beforeEach(async () => {
  await resetApp();
  ({ id: adminId, cookie } = await adminSession());
  alice = await createUser({ username: "alice" });
  bob = await createUser({ username: "bob" });
  boxA = await insertMailbox("a@example.com");
  boxB = await insertMailbox("b@example.com");
  group = await insertRuleGroup("g1");
});

const batch = async (json: Record<string, unknown>) => {
  const res = await api("/api/admin/grants/batch", { cookie, json });
  return { status: res.status, body: (await res.json()) as GrantBatchResponse & ErrorBody };
};

const listGrants = async (query: string) => {
  const res = await api(`/api/admin/grants?${query}`, { cookie });
  return { status: res.status, body: (await res.json()) as AdminGrantListResponse & ErrorBody };
};

const future = () => nowSec() + 3600;

describe("批量授权", () => {
  it("多个用户 × 多个地址一次建好，返回逐条结果与汇总，写一条审计", async () => {
    const { status, body } = await batch({ user_ids: [alice, bob], mailbox_ids: [boxA, boxB], rule_group_id: group, expires_at: future() });
    expect(status).toBe(200);
    expect(body.summary).toEqual({ created: 4, updated: 0, skipped: 0, failed: 0 });
    expect(body.results).toHaveLength(4);
    expect(body.results.every((r) => r.status === "created" && r.grant_id !== null)).toBe(true);

    const rows = await auditRows("grant.batch");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: adminId, target_type: "grant" });
    expect(JSON.parse(rows[0]?.detail ?? "{}")).toMatchObject({ on_conflict: "skip", rule_group_id: group, created: expect.arrayContaining([{ user_id: alice, mailbox_id: boxA }]) });
    expect(JSON.parse(rows[0]?.detail ?? "{}").created).toHaveLength(4);
  });

  it("rule_group_id 必须显式给出；null = 完整访问", async () => {
    expect((await batch({ user_ids: [alice], mailbox_ids: [boxA] })).status).toBe(400);
    const full = await batch({ user_ids: [alice], mailbox_ids: [boxA], rule_group_id: null });
    expect(full.status).toBe(200);
    const id = full.body.results[0]?.grant_id ?? 0;
    expect(await grantRow(id)).toEqual({ first_access_at: null, rule_group_id: null });
  });

  it("已有授权：默认 skip 保持不动；update 改成本次设置并在审计里留旧值；内容相同不算更新", async () => {
    const other = await insertRuleGroup("g2");
    await batch({ user_ids: [alice], mailbox_ids: [boxA], rule_group_id: group });

    const skipped = await batch({ user_ids: [alice], mailbox_ids: [boxA, boxB], rule_group_id: other });
    expect(skipped.body.summary).toEqual({ created: 1, updated: 0, skipped: 1, failed: 0 });
    expect(skipped.body.results[0]).toMatchObject({ status: "skipped", reason: "already_exists" });
    const unchangedGrant = await listGrants(`user_id=${alice}`);
    expect(unchangedGrant.body.items.find((g) => g.mailbox_id === boxA)?.rule_group_id).toBe(group);

    const updated = await batch({ user_ids: [alice], mailbox_ids: [boxA], rule_group_id: other, on_conflict: "update" });
    expect(updated.body.summary).toEqual({ created: 0, updated: 1, skipped: 0, failed: 0 });
    const after = await listGrants(`user_id=${alice}`);
    expect(after.body.items.find((g) => g.mailbox_id === boxA)).toMatchObject({ rule_group_id: other, rule_group_name: "g2" });

    const same = await batch({ user_ids: [alice], mailbox_ids: [boxA], rule_group_id: other, on_conflict: "update" });
    expect(same.body.results[0]).toMatchObject({ status: "skipped", reason: "unchanged" });

    const audit = await auditRows("grant.batch");
    // 三次有变化的批量各一条（建、建 + 跳过、更新）；内容相同的那次没有变化，不写审计
    expect(audit).toHaveLength(3);
    const updateEntry = JSON.parse(audit.at(-1)?.detail ?? "{}") as { updated: Array<{ before: { rule_group_id: number } }> };
    expect(updateEntry.updated[0]?.before.rule_group_id).toBe(group);
  });

  it("给管理员授权：整批 400，什么都不写", async () => {
    const { status, body } = await batch({ user_ids: [alice, adminId], mailbox_ids: [boxA], rule_group_id: null });
    expect(status).toBe(400);
    expect(body.error.code).toBe("grant_admin_user");
    expect((await listGrants(`mailbox_id=${boxA}`)).body.items).toHaveLength(0);
  });

  it("规则组不存在 / 配置无效：400", async () => {
    const missing = await batch({ user_ids: [alice], mailbox_ids: [boxA], rule_group_id: 9999 });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("rule_group_not_found");

    const broken = await insertRuleGroup("broken", { schema_version: 9 });
    const invalid = await batch({ user_ids: [alice], mailbox_ids: [boxA], rule_group_id: broken });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("rule_group_unsupported_version");
    expect(await auditRows("grant.batch")).toHaveLength(0);
  });

  it("过期时间必须在未来；用户或地址不存在逐条 failed", async () => {
    const past = await batch({ user_ids: [alice], mailbox_ids: [boxA], rule_group_id: null, expires_at: nowSec() - 5 });
    expect(past.status).toBe(400);
    expect(past.body.error.code).toBe("expires_at_in_past");

    const partial = await batch({ user_ids: [alice, 9999], mailbox_ids: [boxA, 8888], rule_group_id: null });
    expect(partial.body.summary).toEqual({ created: 1, updated: 0, skipped: 0, failed: 3 });
    expect(partial.body.results.map((r) => r.reason)).toEqual([null, "mailbox_not_found", "user_not_found", "user_not_found"]);
  });

  it("上限：用户数 × 地址数超过 GRANT_BATCH_MAX_PAIRS 被拒", async () => {
    const userIds = Array.from({ length: 50 }, (_, i) => i + 1);
    const mailboxIds = Array.from({ length: Math.floor(GRANT_BATCH_MAX_PAIRS / 50) + 1 }, (_, i) => i + 1);
    expect((await batch({ user_ids: userIds, mailbox_ids: mailboxIds, rule_group_id: null })).status).toBe(400);
  });
});

describe("查询、修改、删除", () => {
  it("按用户或按收件地址查，至少给一个；带地址、规则组名、过期与首次访问；游标分页", async () => {
    const past = nowSec() - 100;
    await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: group, expiresAt: past, firstAccessAt: 123 });
    await insertGrant({ userId: alice, mailboxId: boxB });
    await insertGrant({ userId: bob, mailboxId: boxA });

    expect((await listGrants("")).status).toBe(400);
    const byUser = await listGrants(`user_id=${alice}`);
    expect(byUser.body.items.map((g) => g.address)).toEqual(["b@example.com", "a@example.com"]);
    expect(byUser.body.items[1]).toMatchObject({
      username: "alice",
      rule_group_name: "g1",
      expires_at: past,
      expired: true,
      effective: false,
      first_access_at: 123,
    });
    expect((await listGrants(`mailbox_id=${boxA}`)).body.items.map((g) => g.username)).toEqual(["bob", "alice"]);

    const page1 = await listGrants(`user_id=${alice}&limit=1`);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.next_cursor).not.toBeNull();
    const page2 = await listGrants(`user_id=${alice}&limit=1&cursor=${page1.body.next_cursor}`);
    expect(page2.body.items.map((g) => g.address)).toEqual(["a@example.com"]);
    expect(page2.body.next_cursor).toBeNull();
  });

  it("停用的收件地址：授权存在但 effective=false", async () => {
    const disabled = await insertMailbox("off@example.com", "disabled");
    await insertGrant({ userId: alice, mailboxId: disabled });
    expect((await listGrants(`user_id=${alice}`)).body.items[0]).toMatchObject({ mailbox_status: "disabled", expired: false, effective: false });
  });

  it("PATCH：换规则组、改过期、可清成完整访问与永不过期；审计留旧值", async () => {
    const other = await insertRuleGroup("g2");
    const id = await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: group, expiresAt: future() });
    const oldExpiry = (await listGrants(`user_id=${alice}`)).body.items[0]?.expires_at;

    const res = await api(`/api/admin/grants/${id}`, { method: "PATCH", cookie, json: { rule_group_id: other } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AdminGrant).rule_group_name).toBe("g2");

    const cleared = await api(`/api/admin/grants/${id}`, { method: "PATCH", cookie, json: { rule_group_id: null, expires_at: null } });
    expect(await cleared.json()).toMatchObject({ rule_group_id: null, rule_group_name: null, expires_at: null, effective: true });

    const audit = await auditRows("grant.update");
    expect(audit).toHaveLength(2);
    expect(JSON.parse(audit[0]?.detail ?? "{}")).toMatchObject({ before: { rule_group_id: group, expires_at: oldExpiry }, patch: { rule_group_id: other } });
  });

  it("换规则组沿用原 first_access_at（单条 PATCH 与批量 update 都不重置）", async () => {
    const other = await insertRuleGroup("g2");
    const id = await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: group, firstAccessAt: 123 });
    await api(`/api/admin/grants/${id}`, { method: "PATCH", cookie, json: { rule_group_id: other } });
    expect((await grantRow(id))?.first_access_at).toBe(123);
    await batch({ user_ids: [alice], mailbox_ids: [boxA], rule_group_id: group, on_conflict: "update" });
    expect(await grantRow(id)).toEqual({ first_access_at: 123, rule_group_id: group });
  });

  it("PATCH 校验：空请求 400、规则组无效 400、过去的过期时间 400、不存在 404", async () => {
    const id = await insertGrant({ userId: alice, mailboxId: boxA });
    const patch = async (target: number | string, json: unknown) => await api(`/api/admin/grants/${target}`, { method: "PATCH", cookie, json });
    expect((await patch(id, {})).status).toBe(400);
    expect((await patch(id, { rule_group_id: 9999 })).status).toBe(400);
    expect((await patch(id, { expires_at: nowSec() - 1 })).status).toBe(400);
    expect((await patch(9999, { rule_group_id: null })).status).toBe(404);
    expect(await auditRows("grant.update")).toHaveLength(0);
  });

  it("DELETE：删除并写审计（含旧值）；再删 404", async () => {
    const id = await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: group });
    const res = await api(`/api/admin/grants/${id}`, { method: "DELETE", cookie });
    expect(res.status).toBe(200);
    expect(await grantRow(id)).toBeNull();
    const audit = await auditRows("grant.delete");
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.detail ?? "{}")).toMatchObject({ username: "alice", address: "a@example.com", rule_group_id: group, rule_group_name: "g1" });
    expect((await api(`/api/admin/grants/${id}`, { method: "DELETE", cookie })).status).toBe(404);
  });

  it("规则组被授权引用时不能删（RESTRICT）；删用户级联删授权", async () => {
    const id = await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: group });
    expect((await api(`/api/admin/rule-groups/${group}`, { method: "DELETE", cookie })).status).toBe(409);
    expect((await api(`/api/admin/users/${alice}`, { method: "DELETE", cookie })).status).toBe(200);
    expect(await grantRow(id)).toBeNull();
  });
});

describe("访问控制与用户列表", () => {
  it("未登录 401、普通用户 403", async () => {
    expect((await api(`/api/admin/grants?user_id=${alice}`)).status).toBe(401);
    const { cookie: userCookie } = await createSessionCookie(alice);
    for (const [method, path, json] of [
      ["GET", `/api/admin/grants?user_id=${alice}`, undefined],
      ["POST", "/api/admin/grants/batch", { user_ids: [alice], mailbox_ids: [boxA], rule_group_id: null }],
      ["PATCH", "/api/admin/grants/1", { rule_group_id: null }],
      ["DELETE", "/api/admin/grants/1", undefined],
    ] as const) {
      expect((await api(path, { method, json, cookie: userCookie })).status, `${method} ${path}`).toBe(403);
    }
    expect(await grantRow(1)).toBeNull();
    expect(await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM user_mailbox_grants").first()).toEqual({ n: 0 });
  });

  it("管理端用户列表的 mailbox_grant_count 统计全部授权（含已过期、地址已停用的）", async () => {
    const disabled = await insertMailbox("off@example.com", "disabled");
    await insertGrant({ userId: alice, mailboxId: boxA });
    await insertGrant({ userId: alice, mailboxId: boxB, expiresAt: nowSec() - 10 });
    await insertGrant({ userId: alice, mailboxId: disabled });
    const res = await api("/api/admin/users?q=alice", { cookie });
    const { items } = (await res.json()) as { items: AdminUser[] };
    expect(items[0]?.mailbox_grant_count).toBe(3);
  });
});
