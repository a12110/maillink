import { describe, expect, it } from "vitest";
import { buildCreateBody, effectiveReveal, EMPTY_DRAFT, isLimited } from "./create-form";
import type { CreateDraft } from "./create-form";

const NOW_MS = 1_800_000_000_000;
const NOW = NOW_MS / 1000;

const draft = (patch: Partial<CreateDraft> = {}): CreateDraft => ({
  ...EMPTY_DRAFT,
  mailboxes: [
    { id: 1, address: "a@icloud.com" },
    { id: 2, address: "b@icloud.com" },
  ],
  ruleGroupId: 7,
  ...patch,
});

function body(patch: Partial<CreateDraft>) {
  const result = buildCreateBody(draft(patch), NOW_MS);
  if (!result.ok) throw new Error(`不应失败：${JSON.stringify(result.errors)}`);
  return result.body;
}

describe("创建表单 → 请求体", () => {
  it("默认：一址一链、自动显示、过期时间交给服务端默认", () => {
    const result = body({});
    expect(result).toMatchObject({ mode: "per_mailbox", mailbox_ids: [1, 2], rule_group_id: 7, status: "active" });
    expect(result.access).toMatchObject({ reveal: "auto", turnstile: false, ip_allow: [], country_allow: [] });
    expect("expires_at" in result).toBe(false);
    expect(result.access?.password).toBeUndefined();
  });

  it("设了总次数或每日次数：自动切到点击取码，并说明（isLimited / effectiveReveal）", () => {
    expect(isLimited(draft())).toBe(false);
    expect(effectiveReveal(draft({ reveal: "auto" }))).toBe("auto");
    expect(effectiveReveal(draft({ reveal: "auto", maxTotal: "2" }))).toBe("click");
    expect(effectiveReveal(draft({ reveal: "auto", maxPerDay: "10" }))).toBe("click");
    expect(body({ reveal: "auto", maxTotal: "2" }).access).toMatchObject({ reveal: "click", max_deliveries_total: 2 });
    expect(body({ reveal: "auto", maxPerDay: "10" }).access).toMatchObject({ reveal: "click", max_deliveries_per_day: 10 });
  });

  it("口令、设备数、轮询间隔、白名单（IP 规范化、国家大写）", () => {
    const result = body({ password: "hunter2000", maxDevices: "1", pollInterval: "30", ipAllow: "1.2.3.4\n10.0.0.0/8, 2001:db8::/32", countryAllow: "cn us" });
    expect(result.access).toMatchObject({ password: "hunter2000", max_devices: 1, poll_interval_sec: 30, country_allow: ["CN", "US"] });
    expect(result.access?.ip_allow).toHaveLength(3);
  });

  it("过期方式：默认 / 不过期 / N 天后 / 首次取码后", () => {
    expect(body({ expiry: "never" }).expires_at).toBeNull();
    expect(body({ expiry: "days", expiryDays: "30" }).expires_at).toBe(NOW + 30 * 86_400);
    const after = body({ expiry: "after_first", afterFirstAmount: "12", afterFirstUnit: "hour" });
    expect(after).toMatchObject({ expires_at: null, expire_after_first_access_sec: 12 * 3600 });
  });

  it("买家标题与说明、名称、订单号：空白不提交", () => {
    const result = body({ name: "  订单 A1  ", orderRef: "", publicTitle: " ", publicNote: "联系我\n微信 x" });
    expect(result.name).toBe("订单 A1");
    expect(result.order_ref).toBeUndefined();
    expect(result.public_title).toBeUndefined();
    expect(result.public_note).toBe("联系我\n微信 x");
  });

  it("Turnstile 开关原样带上", () => {
    expect(body({ turnstile: true }).access?.turnstile).toBe(true);
  });
});

describe("创建表单校验（错误按字段归位）", () => {
  const errors = (patch: Partial<CreateDraft>) => {
    const result = buildCreateBody(draft(patch), NOW_MS);
    return result.ok ? null : result.errors;
  };

  it("没选地址、没选规则组", () => {
    expect(errors({ mailboxes: [] })?.mailboxes).toBeTruthy();
    expect(errors({ ruleGroupId: null })?.ruleGroupId).toBeTruthy();
  });

  it("数字字段：非正整数、超上限", () => {
    expect(errors({ maxTotal: "0" })?.maxTotal).toContain("正整数");
    expect(errors({ maxDevices: "abc" })?.maxDevices).toContain("正整数");
    expect(errors({ maxDevices: "101" })?.maxDevices).toContain("最大");
    expect(errors({ pollInterval: "5" })?.pollInterval).toBeTruthy();
  });

  it("口令太短、IP / 国家不合法（用 shared 的同一个 schema）", () => {
    expect(errors({ password: "123" })?.password).toBeTruthy();
    expect(errors({ ipAllow: "not-an-ip" })?.ipAllow).toBeTruthy();
    expect(errors({ countryAllow: "ZZ" })?.countryAllow).toBeTruthy();
  });

  it("合并为一链最多 50 个地址", () => {
    const many = Array.from({ length: 51 }, (_, index) => ({ id: index + 1, address: `a${index}@x.com` }));
    expect(errors({ mode: "combined", mailboxes: many })?.mailboxes).toContain("50");
    expect(errors({ mode: "per_mailbox", mailboxes: many })).toBeNull();
  });

  it("过期天数 / 首次取码后时长不合法", () => {
    expect(errors({ expiry: "days", expiryDays: "" })?.expiry).toBeTruthy();
    expect(errors({ expiry: "after_first", afterFirstAmount: "x" })?.expiry).toBeTruthy();
  });
});
