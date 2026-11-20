import { describe, expect, it } from "vitest";
import { classifyPickupError, describeStartError } from "./failures";
import { PickupError } from "./pickup-api";

const err = (status: number, code: string, extra: Record<string, unknown> = {}) => new PickupError(status, code, "服务端文案", extra);

describe("取件页错误 → 页面状态", () => {
  it.each([
    [404, "link_not_found", { kind: "not_found" }],
    [410, "link_unavailable", { kind: "unavailable" }],
    [403, "link_not_yet_valid", { kind: "not_yet_valid", validFrom: 1_800_000_000 }],
    [403, "link_device_limit", { kind: "device_limit", publicNote: "加微信 x" }],
    [429, "link_daily_limit", { kind: "daily_limit", retryAfterAt: 1_800_000_500 }],
    [401, "link_start_required", { kind: "start_required" }],
    [409, "link_no_mailbox", { kind: "no_mailbox" }],
  ])("HTTP %i %s", (status, code, expected) => {
    const extra = { valid_from: 1_800_000_000, public_note: "加微信 x", retry_after_at: 1_800_000_500 };
    expect(classifyPickupError(err(status, code, extra))).toEqual(expected);
  });

  it("未知错误码（含 404 / 410 状态但码不对）不冒充“已失效”，保留原因", () => {
    const unknown = err(410, "something_else");
    expect(classifyPickupError(unknown)).toEqual({ kind: "other", error: unknown });
    const network = new Error("offline");
    expect(classifyPickupError(network)).toEqual({ kind: "other", error: network });
  });

  it("device_limit 没带 public_note 时为 null", () => {
    expect(classifyPickupError(err(403, "link_device_limit"))).toEqual({ kind: "device_limit", publicNote: null });
  });
});

describe("开始取码的就地错误（400 / 403 / 429）", () => {
  it("口令缺失、错误", () => {
    expect(describeStartError(err(400, "link_password_required")).message).toBe("请输入访问口令");
    expect(describeStartError(err(403, "link_password_invalid"))).toEqual({
      message: "访问口令不正确，请向卖家确认后重试",
      detail: "link_password_invalid · HTTP 403",
    });
  });

  it("口令锁定：写出何时可重试", () => {
    const now = new Date(2026, 10, 20, 9, 0, 0);
    const retryAt = Math.floor(new Date(2026, 10, 20, 9, 15, 0).getTime() / 1000);
    const problem = describeStartError(err(429, "link_password_locked", { retry_after_at: retryAt }), now);
    expect(problem.message).toContain("11-20 09:15");
    expect(problem.detail).toBe("link_password_locked · HTTP 429");
  });

  it("人机验证失败、限流", () => {
    expect(describeStartError(err(400, "turnstile_failed")).message).toContain("人机验证未通过");
    expect(describeStartError(err(429, "rate_limited")).message).toContain("太频繁");
  });

  it("其他错误显示服务端文案与错误码", () => {
    expect(describeStartError(err(500, "internal_error"))).toEqual({ message: "服务端文案", detail: "internal_error · HTTP 500" });
  });
});
