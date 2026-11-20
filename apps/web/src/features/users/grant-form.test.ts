import { describe, expect, it } from "vitest";
import type { AdminGrant } from "@maillink/shared";
import { buildBatchRequest, buildGrantPatch, grantStatus, parseExpiresLocal, summarizeBatch, toDatetimeLocal } from "./grant-form";

const NOW = 1_800_000_000;
const BASE = { mailboxIds: [3, 5], ruleGroupId: 2, expiresLocal: "", onConflict: "skip" as const };

function grant(overrides: Partial<AdminGrant> = {}): AdminGrant {
  return {
    id: 1, user_id: 9, username: "bob", mailbox_id: 3, address: "a@x.com", mailbox_status: "active",
    rule_group_id: 2, rule_group_name: "取码", expires_at: null, expired: false, effective: true,
    first_access_at: null, created_at: 1, ...overrides,
  };
}

describe("批量授权请求体", () => {
  it("选收件地址 + 规则组 + 不过期 + 跳过冲突", () => {
    expect(buildBatchRequest(9, BASE, NOW)).toEqual({
      ok: true,
      value: { user_ids: [9], mailbox_ids: [3, 5], rule_group_id: 2, expires_at: null, on_conflict: "skip" },
    });
  });

  it("“完整访问”显式发 rule_group_id: null，而不是省略", () => {
    const built = buildBatchRequest(9, { ...BASE, ruleGroupId: null, onConflict: "update" }, NOW);
    expect(built.ok && built.value).toMatchObject({ rule_group_id: null, on_conflict: "update" });
    expect(built.ok && "rule_group_id" in built.value).toBe(true);
  });

  it("过期时间：本地时间 → Unix 秒", () => {
    const local = toDatetimeLocal(NOW + 86_400);
    const built = buildBatchRequest(9, { ...BASE, expiresLocal: local }, NOW);
    expect(built.ok && built.value.expires_at).toBe(NOW + 86_400 - ((NOW + 86_400) % 60));
  });

  it("没选收件地址、过期时间已过去、格式不对：不生成请求体", () => {
    expect(buildBatchRequest(9, { ...BASE, mailboxIds: [] }, NOW)).toEqual({ ok: false, error: "请至少选择一个收件地址" });
    expect(buildBatchRequest(9, { ...BASE, expiresLocal: toDatetimeLocal(NOW - 3600) }, NOW)).toMatchObject({ ok: false });
    expect(parseExpiresLocal("not-a-date", NOW)).toEqual({ ok: false, error: "过期时间格式不对" });
  });

  it("超过一次最多的地址数会被拒绝", () => {
    const many = Array.from({ length: 501 }, (_, i) => i + 1);
    expect(buildBatchRequest(9, { ...BASE, mailboxIds: many }, NOW)).toMatchObject({ ok: false });
  });
});

describe("修改授权：只提交改过的字段", () => {
  it("只换规则组", () => {
    expect(buildGrantPatch(grant(), { ruleGroupId: 4, expiresLocal: "" }, NOW)).toEqual({ ok: true, value: { rule_group_id: 4 } });
  });

  it("改成完整访问 = rule_group_id: null；清除过期 = expires_at: null", () => {
    const withExpiry = grant({ expires_at: NOW + 3600 });
    expect(buildGrantPatch(withExpiry, { ruleGroupId: null, expiresLocal: "" }, NOW)).toEqual({
      ok: true,
      value: { rule_group_id: null, expires_at: null },
    });
  });

  it("什么都没改：不发请求", () => {
    expect(buildGrantPatch(grant(), { ruleGroupId: 2, expiresLocal: "" }, NOW)).toEqual({ ok: false, error: "没有改动" });
  });
});

describe("授权状态与批量结果", () => {
  it("有效 / 已过期 / 地址已停用", () => {
    expect(grantStatus(grant()).label).toBe("有效");
    expect(grantStatus(grant({ effective: false, expired: true }))).toEqual({ tone: "danger", label: "已过期" });
    expect(grantStatus(grant({ effective: false, mailbox_status: "disabled" })).label).toBe("地址已停用");
  });

  it("摘要：失败为 0 时不显示失败", () => {
    expect(summarizeBatch({ created: 2, updated: 1, skipped: 3, failed: 0 })).toBe("新增 2，更新 1，跳过 3");
    expect(summarizeBatch({ created: 0, updated: 0, skipped: 0, failed: 2 })).toContain("失败 2");
  });
});
