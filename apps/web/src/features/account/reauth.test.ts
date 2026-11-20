import { describe, expect, it } from "vitest";
import { availableReauthModes, buildReauthBody } from "./reauth";

describe("再确认方式", () => {
  it("有密码：默认用密码；启用了 2FA 时可改用验证码", () => {
    expect(availableReauthModes({ hasPassword: true, totpEnabled: false, allowRecentSession: true })).toEqual(["password"]);
    expect(availableReauthModes({ hasPassword: true, totpEnabled: true, allowRecentSession: true })).toEqual(["password", "code"]);
  });

  it("没有密码：添加通行密钥 / 启用 2FA 可凭最近登录（空请求体）", () => {
    expect(availableReauthModes({ hasPassword: false, totpEnabled: false, allowRecentSession: true })).toEqual(["none"]);
    expect(availableReauthModes({ hasPassword: false, totpEnabled: true, allowRecentSession: true })).toEqual(["code", "none"]);
  });

  it("没有密码时关闭 2FA / 重新生成恢复码不接受最近登录，只能用验证码", () => {
    expect(availableReauthModes({ hasPassword: false, totpEnabled: true, allowRecentSession: false })).toEqual(["code"]);
  });
});

describe("再确认请求体的三种形态", () => {
  it("{password}", () => {
    expect(buildReauthBody("password", { password: "pw", code: "" })).toEqual({ ok: true, body: { password: "pw" } });
  });

  it("{code}", () => {
    expect(buildReauthBody("code", { password: "", code: " 123456 " })).toEqual({ ok: true, body: { code: "123456" } });
  });

  it("{}（没有密码的账号）", () => {
    const built = buildReauthBody("none", { password: "ignored", code: "ignored" });
    expect(built).toEqual({ ok: true, body: {} });
  });

  it("密码为空 / 验证码格式不对：不生成请求体", () => {
    expect(buildReauthBody("password", { password: "", code: "" })).toMatchObject({ ok: false });
    expect(buildReauthBody("code", { password: "", code: "12ab" })).toMatchObject({ ok: false });
  });
});
