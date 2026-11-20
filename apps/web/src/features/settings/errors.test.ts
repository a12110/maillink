import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/errors";
import { describeSettingsError } from "./errors";

const BAD_REQUEST = 400;
const CONFLICT = 409;

describe("设置接口错误码 → 中文说明", () => {
  it.each([
    ["accent_unreachable", "强调色"],
    ["login_methods_lockout", "锁在系统外"],
    ["admin_2fa_lockout", "两步验证"],
    ["turnstile_incomplete", "site key"],
    ["validation_error", "不合法"],
  ])("%s 有中文说明，并保留服务端原文与错误码", (code, keyword) => {
    const { message, detail } = describeSettingsError(new ApiError(BAD_REQUEST, code, "server-detail-text"));
    expect(message).toContain(keyword);
    expect(message).toContain("server-detail-text");
    expect(detail).toBe(`${code} · HTTP ${BAD_REQUEST}`);
  });

  it("oauth_provider_has_identities 说明原因并带上绑定数量等服务端信息", () => {
    const { message } = describeSettingsError(new ApiError(CONFLICT, "oauth_provider_has_identities", "该提供方已有 3 个绑定"));
    expect(message).toContain("同一个 subject");
    expect(message).toContain("已有 3 个绑定");
  });

  it("表里没有的错误码仍显示服务端 message，不吞原因", () => {
    expect(describeSettingsError(new ApiError(500, "something_new", "boom"))).toEqual({ message: "boom", detail: "something_new · HTTP 500" });
  });
});
