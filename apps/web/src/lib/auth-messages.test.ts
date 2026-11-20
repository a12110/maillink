import { describe, expect, it } from "vitest";
import { ApiError } from "../api/errors";
import { describeAuthError, describeRateLimit } from "./auth-messages";

describe("认证错误文案", () => {
  it("限流：有 Retry-After 写“约 N 秒”，没有就只说稍等", () => {
    expect(describeRateLimit(60)).toBe("请求太频繁了，请约 60 秒后再试。");
    expect(describeRateLimit(undefined)).toBe("请求太频繁了，请稍等一会儿再试。");
    expect(describeAuthError(new ApiError(429, "rate_limited", "x", 30))).toEqual({
      message: "请求太频繁了，请约 30 秒后再试。",
      detail: "rate_limited · HTTP 429",
    });
  });

  it("mfa_locked 的 429 不被当成普通限流：沿用服务端的锁定说明", () => {
    const error = new ApiError(429, "mfa_locked", "验证失败次数过多，请约 15 分钟后再试");
    expect(describeAuthError(error).message).toBe("验证失败次数过多，请约 15 分钟后再试");
  });

  it("last_login_method：说明这是唯一的登录方式", () => {
    const { message, detail } = describeAuthError(new ApiError(409, "last_login_method", "至少需要保留一种登录方式"));
    expect(message).toContain("唯一的登录方式");
    expect(detail).toContain("last_login_method");
  });

  it("reauth_required / reauth_failed 沿用服务端中文消息并带错误码", () => {
    expect(describeAuthError(new ApiError(400, "reauth_failed", "当前密码或验证码错误"))).toEqual({
      message: "当前密码或验证码错误",
      detail: "reauth_failed · HTTP 400",
    });
  });
});
