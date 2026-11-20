import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/errors";
import { classifyMfaError, INITIAL_LOGIN_STATE, loginReducer, mfaEndpoint } from "./login-flow";
import type { LoginState, MfaFailure } from "./login-flow";

const inMfa: LoginState = { step: { kind: "mfa", method: "totp" }, notice: null };

describe("classifyMfaError：第二步错误码分类", () => {
  it("invalid_mfa_code → 可重试，保留服务端带剩余次数的文案", () => {
    const failure = classifyMfaError(new ApiError(401, "invalid_mfa_code", "验证码错误，还可尝试 3 次"));
    expect(failure).toEqual({ kind: "retry", message: "验证码错误，还可尝试 3 次" });
  });

  it("mfa_pending_invalid → 必须回密码步", () => {
    expect(classifyMfaError(new ApiError(401, "mfa_pending_invalid", "登录验证已失效，请重新登录")).kind).toBe("restart");
  });

  it("mfa_locked（429）→ 锁定，不同于普通限流", () => {
    expect(classifyMfaError(new ApiError(429, "mfa_locked", "验证失败次数过多，请约 15 分钟后再试")).kind).toBe("locked");
  });

  it("rate_limited（429）→ 带 Retry-After 秒数", () => {
    expect(classifyMfaError(new ApiError(429, "rate_limited", "x", {}, 60))).toEqual({
      kind: "rate_limited",
      message: "请求太频繁了，请约 60 秒后再试。",
      retryAfterSec: 60,
    });
    expect(classifyMfaError(new ApiError(429, "rate_limited", "x"))).toMatchObject({ kind: "rate_limited", retryAfterSec: null });
  });

  it("其他错误原样保留（不吞）", () => {
    const error = new ApiError(500, "internal_error", "boom");
    expect(classifyMfaError(error)).toEqual({ kind: "error", error });
  });
});

describe("loginReducer：密码步 ⇄ 第二步", () => {
  it("mfa_required → 进入 TOTP 步；切换到恢复码再切回", () => {
    const step1 = loginReducer(INITIAL_LOGIN_STATE, { type: "mfa_required" });
    expect(step1.step).toEqual({ kind: "mfa", method: "totp" });
    const step2 = loginReducer(step1, { type: "use_method", method: "recovery" });
    expect(step2.step).toEqual({ kind: "mfa", method: "recovery" });
    expect(loginReducer(step2, { type: "use_method", method: "totp" }).step).toEqual({ kind: "mfa", method: "totp" });
  });

  it("密码步里切换方式无效", () => {
    expect(loginReducer(INITIAL_LOGIN_STATE, { type: "use_method", method: "recovery" })).toBe(INITIAL_LOGIN_STATE);
  });

  it.each<[string, MfaFailure, "mfa" | "password"]>([
    ["retry", { kind: "retry", message: "m" }, "mfa"],
    ["locked", { kind: "locked", message: "m" }, "mfa"],
    ["rate_limited", { kind: "rate_limited", message: "m", retryAfterSec: 60 }, "mfa"],
    ["error", { kind: "error", error: new Error("x") }, "mfa"],
    ["restart", { kind: "restart", message: "m" }, "password"],
  ])("第二步失败 %s → 停在 %s 步并带提示", (_name, failure, expected) => {
    const next = loginReducer({ ...inMfa, step: { kind: "mfa", method: "recovery" } }, { type: "mfa_failed", failure });
    expect(next.step.kind).toBe(expected);
    expect(next.notice).toEqual({ kind: "mfa", failure });
    // 重试 / 锁定时保持用户选的方式（恢复码不会被悄悄切回 TOTP）
    if (expected === "mfa") expect(next.step).toEqual({ kind: "mfa", method: "recovery" });
  });

  it("返回密码步清空提示", () => {
    const failed = loginReducer(inMfa, { type: "mfa_failed", failure: { kind: "retry", message: "m" } });
    expect(loginReducer(failed, { type: "back_to_password" })).toEqual(INITIAL_LOGIN_STATE);
  });

  it("密码错误停在密码步并带原错误", () => {
    const error = new ApiError(401, "invalid_credentials", "x");
    expect(loginReducer(INITIAL_LOGIN_STATE, { type: "password_failed", error }).notice).toEqual({ kind: "password_error", error });
  });
});

describe("loginReducer：OAuth 回跳", () => {
  it("oauth=mfa_required → 直接进入第二步，不显示提示", () => {
    expect(loginReducer(INITIAL_LOGIN_STATE, { type: "oauth_result", code: "mfa_required", provider: "github" })).toEqual(inMfa);
  });

  it("其他结果码 → 密码步 + 说明", () => {
    expect(loginReducer(INITIAL_LOGIN_STATE, { type: "oauth_result", code: "not_linked", provider: "github" })).toEqual({
      step: { kind: "password" },
      notice: { kind: "oauth", code: "not_linked", provider: "github" },
    });
  });
});

describe("mfaEndpoint", () => {
  it("TOTP 与恢复码走各自的接口", () => {
    expect(mfaEndpoint("totp")).toBe("mfaTotp");
    expect(mfaEndpoint("recovery")).toBe("mfaRecovery");
  });
});
