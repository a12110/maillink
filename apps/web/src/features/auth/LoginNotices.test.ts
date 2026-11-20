// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "../../api/errors";
import { mount } from "../../test/render";
import type { Mounted } from "../../test/render";
import { LoginNotices } from "./LoginNotices";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

async function title(error: unknown): Promise<{ title: string | null | undefined; text: string }> {
  mounted = await mount(createElement(LoginNotices, { notice: { kind: "password_error", error }, providerName: () => null }));
  return { title: mounted.container.querySelector("b")?.textContent, text: mounted.container.textContent ?? "" };
}

describe("登录页错误标题", () => {
  it.each([
    [new ApiError(403, "login_method_disabled", "x"), "密码登录已关闭"],
    [new ApiError(400, "turnstile_failed", "x"), "人机验证没有通过"],
    [new ApiError(503, "turnstile_unavailable", "x"), "人机验证服务暂时不可用"],
    [new ApiError(503, "turnstile_not_configured", "x"), "人机验证尚未配置完整"],
    [new ApiError(502, "unexpected_response", "x"), "服务器返回了无法识别的响应"],
    [new ApiError(500, "internal_error", "x"), "服务器出错"],
    [new NetworkError("/api/auth/login", new Error("down")), "无法连接服务器"],
  ])("%#", async (error, expected) => {
    expect((await title(error)).title).toBe(expected);
  });

  it("turnstile 错误用中文说明表，不显示服务端原文", async () => {
    const { text } = await title(new ApiError(400, "turnstile_failed", "Please complete the captcha"));
    expect(text).toContain("请重新完成验证");
    expect(text).not.toContain("Please complete");
  });
});
