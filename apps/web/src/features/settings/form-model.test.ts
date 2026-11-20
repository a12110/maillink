import { describe, expect, it } from "vitest";
import { SESSION_DURATION_MAX_SEC, SESSION_DURATION_MIN_SEC } from "@maillink/shared";
import type { SettingsByGroup, WritableSettingGroup } from "@maillink/shared";
import { countChanged, formatDuration, GROUP_SPECS, SESSION_DURATION_MAX_TEXT, SESSION_DURATION_MIN_TEXT, toNumber } from "./form-model";

const SAMPLES: { [G in WritableSettingGroup]: SettingsByGroup[G] } = {
  site: { name: "MailLink", logo: "", description: "说明", footer: "页脚", login_notice: "", pickup_notice: "公告" },
  appearance: { preset: "default", accent: "#2f5fa8", mode: "dark", radius: "8" },
  auth: { registration_enabled: true, login_methods: ["password", "passkey"], oauth_require_2fa: false },
  turnstile: { enabled: true, site_key: "0x4AAA", secret_set: true, scopes: ["login", "register"] },
  security: { admin_require_2fa: false, session_idle_sec: 7200, session_absolute_sec: 30 * 86_400, password_min_length: 12 },
  links: { default_expires_in_days: null, default_poll_interval_sec: 30, show_brand: true },
  logs: { access_retention_days: 30, audit_retention_days: 365 },
};

/** GET 响应与 PUT 请求体的差别：turnstile 的 secret_set 不会被提交 */
function expectedInput(group: WritableSettingGroup): unknown {
  if (group !== "turnstile") return SAMPLES[group];
  const { secret_set: _set, ...rest } = SAMPLES.turnstile;
  return rest;
}

describe("设置表单与 schema 往返", () => {
  it.each(Object.keys(SAMPLES) as WritableSettingGroup[])("%s：toDraft → toInput 得到原值", (group) => {
    const spec = GROUP_SPECS[group] as unknown as {
      toDraft: (data: unknown) => unknown;
      toInput: (draft: unknown) => { ok: boolean; value?: unknown };
    };
    const result = spec.toInput(spec.toDraft(SAMPLES[group]));
    expect(result).toEqual({ ok: true, value: expectedInput(group) });
  });

  it("人机验证：secret 留空不进请求体；填了才带上", () => {
    const draft = GROUP_SPECS.turnstile.toDraft(SAMPLES.turnstile);
    expect(draft.secret).toBe("");
    const blank = GROUP_SPECS.turnstile.toInput(draft);
    expect(blank.ok && "secret" in blank.value).toBe(false);
    const filled = GROUP_SPECS.turnstile.toInput({ ...draft, secret: " new-secret " });
    expect(filled).toEqual({ ok: true, value: { enabled: true, site_key: "0x4AAA", scopes: ["login", "register"], secret: "new-secret" } });
  });

  it("取件链接：有效天数留空 = 不过期，填数字 = 天数；非数字报错", () => {
    const draft = GROUP_SPECS.links.toDraft(SAMPLES.links);
    expect(draft.default_expires_in_days).toBe("");
    expect(GROUP_SPECS.links.toInput({ ...draft, default_expires_in_days: "7" })).toMatchObject({ ok: true, value: { default_expires_in_days: 7 } });
    expect(GROUP_SPECS.links.toInput({ ...draft, default_expires_in_days: "abc" })).toMatchObject({ ok: false, fields: { default_expires_in_days: "请输入数字" } });
  });

  it("安全：小时与天换算成秒；违反 schema 的错误回到草稿字段名上", () => {
    const draft = GROUP_SPECS.security.toDraft(SAMPLES.security);
    expect(draft).toMatchObject({ session_idle_hours: "2", session_absolute_days: "30" });
    expect(GROUP_SPECS.security.toInput({ ...draft, session_idle_hours: "1.5" })).toMatchObject({ ok: true, value: { session_idle_sec: 5400 } });
    const tooShort = GROUP_SPECS.security.toInput({ ...draft, session_idle_hours: "0.5" });
    expect(tooShort.ok).toBe(false);
    if (!tooShort.ok) expect(Object.keys(tooShort.fields)).toEqual(["session_idle_hours"]);
    const inverted = GROUP_SPECS.security.toInput({ ...draft, session_idle_hours: "1000" });
    expect(inverted.ok).toBe(false);
  });

  it("安全：会话时长的范围提示与客户端校验都由 shared 的常量换算", () => {
    expect(SESSION_DURATION_MIN_TEXT).toBe("1 小时");
    expect(SESSION_DURATION_MAX_TEXT).toBe("365 天");
    expect(formatDuration(SESSION_DURATION_MIN_SEC)).toBe("1 小时");
    expect(formatDuration(SESSION_DURATION_MAX_SEC)).toBe("365 天");
    const draft = GROUP_SPECS.security.toDraft(SAMPLES.security);
    const tooShort = GROUP_SPECS.security.toInput({ ...draft, session_idle_hours: "0.5" });
    expect(tooShort).toMatchObject({ ok: false, fields: { session_idle_hours: "不能短于 1 小时" } });
    const tooLong = GROUP_SPECS.security.toInput({ ...draft, session_absolute_days: "366" });
    expect(tooLong).toMatchObject({ ok: false, fields: { session_absolute_days: "不能长于 365 天" } });
    expect(GROUP_SPECS.security.toInput({ ...draft, session_idle_hours: "1", session_absolute_days: "365" })).toMatchObject({ ok: true });
  });

  it("站点：名称为空、Logo 不是 https 或 data URI 都被 shared 的 schema 拦下", () => {
    const draft = GROUP_SPECS.site.toDraft(SAMPLES.site);
    const result = GROUP_SPECS.site.toInput({ ...draft, name: "  ", logo: "http://insecure.example.com/a.png" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fields).sort()).toEqual(["logo", "name"]);
  });

  it("登录方式一个都不选时报在 login_methods 上", () => {
    const result = GROUP_SPECS.auth.toInput({ ...GROUP_SPECS.auth.toDraft(SAMPLES.auth), login_methods: [] });
    expect(result).toMatchObject({ ok: false, fields: { login_methods: "至少保留一种登录方式" } });
  });
});

describe("辅助函数", () => {
  it("toNumber：空与非数字返回 null", () => {
    expect([toNumber(""), toNumber("  "), toNumber("x"), toNumber("12"), toNumber("1.5")]).toEqual([null, null, null, 12, 1.5]);
  });

  it("countChanged 数出不同的字段数（数组按值比较）", () => {
    expect(countChanged({ a: 1, b: [1, 2], c: "x" }, { a: 1, b: [1, 2], c: "x" })).toBe(0);
    expect(countChanged({ a: 2, b: [1], c: "x" }, { a: 1, b: [1, 2], c: "x" })).toBe(2);
  });
});
