import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { LINK_POLL_INTERVAL_MIN_SEC, SITE_LOGO_MAX_LENGTH, systemSettingsSchema } from "@maillink/shared";
import { LINK_POLL_MIN_SEC } from "../src/constants";
import { assertAccentAllowed } from "../src/routes/admin-settings-prepare";
import { ApiError } from "../src/errors";
import { adminSession, api, auditRows, createSessionCookie, createUser, resetApp } from "./helpers";
import {
  DEFAULTS,
  TURNSTILE_SECRET,
  TURNSTILE_SITE_KEY,
  enableTurnstile,
  errorCode,
  getSettingsGroup,
  putSettings,
  saveSettings,
} from "./settings-helpers";

type GroupName = keyof typeof DEFAULTS;
const GROUPS = Object.keys(DEFAULTS) as GroupName[];

let cookie: string;
beforeEach(async () => {
  await resetApp();
  cookie = (await adminSession()).cookie;
});

describe("设置分组 API：鉴权与分组名", () => {
  it("未登录 401，普通用户 403，未知分组 404，PUT system 405", async () => {
    expect((await api("/api/admin/settings/site")).status).toBe(401);
    const user = await createUser({ username: "bob" });
    const userCookie = (await createSessionCookie(user)).cookie;
    expect((await getSettingsGroup(userCookie, "site")).status).toBe(403);
    expect((await putSettings(userCookie, "site", DEFAULTS.site)).status).toBe(403);
    const unknown = await getSettingsGroup(cookie, "nope");
    expect(unknown.status).toBe(404);
    const readOnly = await putSettings(cookie, "system", {});
    expect(readOnly.status).toBe(405);
    expect(await errorCode(readOnly)).toBe("group_read_only");
  });
});

describe("设置分组 API：默认值与整组替换", () => {
  it.each(GROUPS)("GET %s 返回默认值", async (group) => {
    const res = await getSettingsGroup(cookie, group);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEFAULTS[group]);
  });

  const VALID: Record<Exclude<GroupName, "turnstile">, Record<string, unknown>> = {
    site: {
      name: "取件中心",
      logo: "https://cdn.example.com/logo.png",
      description: "说明",
      footer: "© 2026",
      login_notice: "登录公告",
      pickup_notice: "取件公告",
    },
    appearance: { preset: "default", accent: "#2F5FA8", mode: "dark", radius: "8" },
    auth: { registration_enabled: true, login_methods: ["password"], oauth_require_2fa: true },
    security: { admin_require_2fa: false, session_idle_sec: 7200, session_absolute_sec: 86_400, password_min_length: 14 },
    links: { default_expires_in_days: 30, default_poll_interval_sec: 60, show_brand: false },
    logs: { access_retention_days: 30, audit_retention_days: 180 },
  };

  it.each(Object.keys(VALID) as Array<keyof typeof VALID>)("PUT %s：保存后 GET 一致，并写审计（含旧值）", async (group) => {
    const body = VALID[group];
    const saved = await saveSettings(cookie, group, body);
    const expected = group === "appearance" ? { ...body, accent: "#2f5fa8" } : body;
    expect(saved).toEqual(expected);
    expect(await (await getSettingsGroup(cookie, group)).json()).toEqual(expected);

    const rows = await auditRows("settings.update");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ target_type: "settings", target_id: group });
    const detail = JSON.parse(rows[0]?.detail ?? "{}") as { group: string; changes: Record<string, { from: unknown; to: unknown }> };
    expect(detail.group).toBe(group);
    const [field] = Object.keys(detail.changes);
    expect(field).toBeDefined();
    const change = detail.changes[field ?? ""];
    expect(change?.from).toEqual((DEFAULTS[group] as Record<string, unknown>)[field ?? ""]);
  });

  it("整组替换：缺字段、多字段都是 400，且不改动已有设置", async () => {
    const { name: _name, ...missing } = DEFAULTS.site;
    expect((await putSettings(cookie, "site", missing)).status).toBe(400);
    expect((await putSettings(cookie, "site", { ...DEFAULTS.site, extra: 1 })).status).toBe(400);
    expect(await (await getSettingsGroup(cookie, "site")).json()).toEqual(DEFAULTS.site);
  });

  it("请求体不是 JSON：400 invalid_json", async () => {
    const res = await api("/api/admin/settings/site", { method: "PUT", cookie, headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(400);
  });
});

describe("设置分组 API：字段校验", () => {
  const invalid: Array<[string, GroupName, Record<string, unknown>]> = [
    ["站点名称为空", "site", { name: "  " }],
    ["Logo 是 http 地址", "site", { logo: "http://cdn.example.com/a.png" }],
    ["Logo 是 javascript:", "site", { logo: "javascript:alert(1)" }],
    ["Logo 是 data:text/html", "site", { logo: "data:text/html;base64,PGgxPg==" }],
    ["Logo 地址带用户名", "site", { logo: "https://user:pw@cdn.example.com/a.png" }],
    ["Logo 超长", "site", { logo: `data:image/png;base64,${"A".repeat(SITE_LOGO_MAX_LENGTH)}` }],
    ["强调色不是 #rrggbb", "appearance", { accent: "red" }],
    ["强调色是三位简写", "appearance", { accent: "#fff" }],
    ["圆角档位不存在", "appearance", { radius: "6" }],
    ["明暗模式不存在", "appearance", { mode: "auto" }],
    ["主题预设不存在", "appearance", { preset: "neon" }],
    ["登录方式为空", "auth", { login_methods: [] }],
    ["登录方式重复", "auth", { login_methods: ["password", "password"] }],
    ["登录方式未知", "auth", { login_methods: ["sms"] }],
    ["空闲时长超过绝对时长", "security", { session_idle_sec: 100_000, session_absolute_sec: 90_000 }],
    ["会话时长太短", "security", { session_idle_sec: 60 }],
    ["密码最小长度低于硬下限", "security", { password_min_length: 9 }],
    ["轮询间隔低于下限", "links", { default_poll_interval_sec: LINK_POLL_INTERVAL_MIN_SEC - 1 }],
    ["默认过期天数为 0", "links", { default_expires_in_days: 0 }],
    ["日志保留 0 天", "logs", { audit_retention_days: 0 }],
    ["Turnstile 作用范围未知", "turnstile", { scopes: ["admin"] }],
  ];

  it.each(invalid)("%s：400 validation_error", async (_label, group, patch) => {
    const res = await putSettings(cookie, group, { ...DEFAULTS[group], secret_set: undefined, ...patch });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("validation_error");
  });

  it("接受 data:image 的 Logo，并保留原样", async () => {
    const logo = "data:image/svg+xml;base64,PHN2Zy8+";
    const saved = await saveSettings(cookie, "site", { ...DEFAULTS.site, logo });
    expect(saved.logo).toBe(logo);
  });

  it("共享的轮询下限与 worker 的 LINK_POLL_MIN_SEC 一致", () => {
    expect(LINK_POLL_INTERVAL_MIN_SEC).toBe(LINK_POLL_MIN_SEC);
  });
});

describe("外观：强调色对比度由服务端保证", () => {
  it("任意合法颜色（含纯白、纯黑）都能保存：明暗两套底色下都能推导出达标颜色", async () => {
    for (const accent of ["#ffffff", "#000000", "#ffff00", "#7f7f7f"]) {
      const saved = await saveSettings(cookie, "appearance", { ...DEFAULTS.appearance, accent });
      expect(saved.accent).toBe(accent);
    }
  });

  it("目标不可达返回 400 accent_unreachable（用一对无法同时达标的底色验证检查本身）", () => {
    const impossible = { surface: "#000000", bg: "#ffffff" };
    const grounds = { light: impossible, dark: impossible };
    let caught: unknown;
    try {
      assertAccentAllowed("#ffff00", grounds);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status: 400, code: "accent_unreachable" });
    // 同一个颜色在真实底色下可达
    expect(() => assertAccentAllowed("#ffff00")).not.toThrow();
  });
});

describe("Turnstile 设置：secret 只加密存储、只回 secret_set", () => {
  it("保存 secret：响应与 GET 只有 secret_set，库里是密文，审计不含 secret", async () => {
    const saved = await enableTurnstile(cookie, ["login", "register"]);
    expect(saved).toEqual({ enabled: true, site_key: TURNSTILE_SITE_KEY, secret_set: true, scopes: ["login", "register"] });
    const got = await (await getSettingsGroup(cookie, "turnstile")).text();
    expect(got).not.toContain(TURNSTILE_SECRET);

    const row = await env.APP_DB.prepare("SELECT value FROM settings WHERE key = 'turnstile.secret_enc'").first<{ value: string }>();
    expect(row?.value).not.toContain(TURNSTILE_SECRET);
    expect(JSON.parse(row?.value ?? "null")).toMatch(/^v1\./);

    const all = await env.APP_DB.prepare("SELECT detail FROM audit_logs").all<{ detail: string | null }>();
    for (const item of all.results) expect(item.detail ?? "").not.toContain(TURNSTILE_SECRET);
    const detail = JSON.parse((await auditRows("settings.update"))[0]?.detail ?? "{}") as Record<string, unknown>;
    expect(detail.new_key_saved).toBe(true);
  });

  it("PUT 不带 secret 表示不改：secret_set 保持 true，密文不变", async () => {
    await enableTurnstile(cookie, ["login"]);
    const before = await env.APP_DB.prepare("SELECT value FROM settings WHERE key = 'turnstile.secret_enc'").first<{ value: string }>();
    const saved = await saveSettings(cookie, "turnstile", { enabled: true, site_key: "new-site-key", scopes: ["register"] });
    expect(saved).toEqual({ enabled: true, site_key: "new-site-key", secret_set: true, scopes: ["register"] });
    const after = await env.APP_DB.prepare("SELECT value FROM settings WHERE key = 'turnstile.secret_enc'").first<{ value: string }>();
    expect(after?.value).toBe(before?.value);
  });

  it("启用时缺 site key、缺 secret、缺作用范围：400 turnstile_incomplete", async () => {
    const base = { enabled: true, site_key: TURNSTILE_SITE_KEY, secret: TURNSTILE_SECRET, scopes: ["login"] };
    for (const body of [{ ...base, site_key: "" }, { ...base, scopes: [] }]) {
      const res = await putSettings(cookie, "turnstile", body);
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("turnstile_incomplete");
    }
    const { secret: _secret, ...noSecret } = base;
    const res = await putSettings(cookie, "turnstile", noSecret);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("turnstile_incomplete");
    // 关闭时可以什么都不填
    expect((await putSettings(cookie, "turnstile", { enabled: false, site_key: "", scopes: [] })).status).toBe(200);
  });
});

describe("系统状态（只读）", () => {
  it("GET system：健康检查字段 + db_version + mail_index 行数；不健康也是 200", async () => {
    const res = await getSettingsGroup(cookie, "system");
    expect(res.status).toBe(200);
    const body = systemSettingsSchema.parse(await res.json());
    expect(body.db_version).toBe("v0.0.11");
    expect(body.mail_index_rows).toBe(0);
    expect(body.rate_limit).toEqual({ configured: true, link_configured: true });
    expect(body.cron).toEqual({ prewarm: null, cleanup: null });

    await env.MAIL_DB.prepare("DROP TABLE raw_mails").run();
    const broken = await getSettingsGroup(cookie, "system");
    expect(broken.status).toBe(200);
    expect(systemSettingsSchema.parse(await broken.json()).ok).toBe(false);
  });
});

describe("公开配置：只含带公开标记的设置", () => {
  it("站点信息、外观、注册开关、Turnstile site key 与范围、密码最小长度可见；secret、其余安全设置、链接默认值、日志保留不可见", async () => {
    await saveSettings(cookie, "site", { ...DEFAULTS.site, name: "我的站", logo: "https://cdn.example.com/l.png", pickup_notice: "取件须知" });
    await saveSettings(cookie, "appearance", { ...DEFAULTS.appearance, mode: "dark", radius: "0" });
    await saveSettings(cookie, "auth", { ...DEFAULTS.auth, registration_enabled: true, oauth_require_2fa: true });
    await enableTurnstile(cookie, ["pickup"]);
    await saveSettings(cookie, "security", { ...DEFAULTS.security, password_min_length: 16 });

    const res = await api("/api/public/config");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TURNSTILE_SECRET);
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body).toMatchObject({
      site_name: "我的站",
      site_logo: "https://cdn.example.com/l.png",
      pickup_notice: "取件须知",
      appearance: { preset: "default", accent: "#c8432b", mode: "dark", radius: "0" },
      registration_enabled: true,
      turnstile: { enabled: true, site_key: TURNSTILE_SITE_KEY, scopes: ["pickup"] },
      // 注册页要提示密码最小长度（M7b）；安全设置里只公开这一项
      password_min_length: 16,
    });
    expect(Object.keys(body).sort()).toEqual(
      [
        "appearance",
        "login_methods",
        "login_notice",
        "oauth_providers",
        "password_min_length",
        "pickup_notice",
        "registration_enabled",
        "site_description",
        "site_footer",
        "site_logo",
        "site_name",
        "turnstile",
      ].sort(),
    );
    expect(Object.keys(body.turnstile as object).sort()).toEqual(["enabled", "scopes", "site_key"]);
  });
});
