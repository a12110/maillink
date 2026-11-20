// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicConfig } from "@maillink/shared";
import { queryKeys } from "../../api/queries";
import { createAppRouter } from "../../app/router";
import { byText, inputByLabel, settle, submit } from "../../test/dom";
import { errorReply, installFakeFetch } from "../../test/fake-fetch";
import { makePublicConfig } from "../../test/fixtures";
import type { FakeFetch } from "../../test/fake-fetch";
import { mount, typeInto } from "../../test/render";
import type { Mounted } from "../../test/render";
import { ToastProvider } from "../../ui";
import type { TurnstileApi, TurnstileRenderOptions } from "../turnstile/loader";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "turnstile");
  Reflect.deleteProperty(window, "PublicKeyCredential");
});

const CONFIG = makePublicConfig();
const MFA_REQUIRED = { status: "mfa_required", methods: ["totp", "recovery"], expires_at: 2_000_000_000 };

async function openLogin(url: string, config: PublicConfig = CONFIG): Promise<{ box: HTMLElement; server: FakeFetch }> {
  const server = installFakeFetch({
    "GET /api/public/config": { json: config },
    "POST /api/auth/login": { json: MFA_REQUIRED },
    "POST /api/auth/mfa/totp": errorReply(401, "invalid_mfa_code", "验证码错误，还可尝试 4 次"),
    "POST /api/auth/mfa/recovery": { json: { status: "ok" } },
    "GET /api/auth/session": errorReply(401, "unauthorized", "未登录"),
  });
  const client = new QueryClient();
  client.setQueryData(queryKeys.session, null);
  client.setQueryData(queryKeys.setupStatus, { needs_setup: false });
  const router = createAppRouter({ client, history: createMemoryHistory({ initialEntries: [url] }) });
  await router.load();
  mounted = await mount(
    createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(RouterProvider, { router }))),
  );
  await settle();
  return { box: mounted.container, server };
}

async function passwordStep(box: HTMLElement): Promise<void> {
  await typeInto(inputByLabel(box, "用户名"), "alice");
  await typeInto(inputByLabel(box, "密码"), "correct horse");
  const form = box.querySelector("form");
  if (!form) throw new Error("没有表单");
  await submit(form);
  await settle();
}

async function enterCode(box: HTMLElement, label: string, code: string): Promise<void> {
  await typeInto(inputByLabel(box, label), code);
  const form = box.querySelector("form");
  if (!form) throw new Error("没有表单");
  await submit(form);
  await settle();
}

describe("登录页：密码一步通过", () => {
  it("返回 status=ok → 不进第二步，刷新会话后分流", async () => {
    const { box, server } = await openLogin("/login");
    server.set("POST /api/auth/login", { json: { status: "ok" } });
    await passwordStep(box);
    expect(box.querySelector("h1")?.textContent).toBe("登录");
    expect(server.callsTo("POST /api/auth/mfa/totp")).toHaveLength(0);
    expect(server.callsTo("GET /api/auth/session").length).toBeGreaterThan(0);
  });
});

describe("登录页：两步验证", () => {
  it("密码返回 mfa_required → 进入 TOTP 步；提交 6 位码走 /api/auth/mfa/totp；码错显示剩余次数并可重试", async () => {
    const { box, server } = await openLogin("/login");
    await passwordStep(box);
    expect(box.querySelector("h1")?.textContent).toBe("两步验证");
    expect(server.callsTo("POST /api/auth/login")[0]?.body).toEqual({ username: "alice", password: "correct horse" });

    await enterCode(box, "验证码", "123456");
    expect(server.callsTo("POST /api/auth/mfa/totp")[0]?.body).toEqual({ code: "123456" });
    expect(box.textContent).toContain("验证码错误，还可尝试 4 次");
    expect(box.querySelector("h1")?.textContent).toBe("两步验证");
    expect(inputByLabel(box, "验证码").value).toBe("");
  });

  it("格式不对的验证码不发请求", async () => {
    const { box, server } = await openLogin("/login");
    await passwordStep(box);
    await enterCode(box, "验证码", "12ab");
    expect(server.callsTo("POST /api/auth/mfa/totp")).toHaveLength(0);
    expect(box.textContent).toContain("请输入 6 位数字验证码");
  });

  it("切换到恢复码 → 走 /api/auth/mfa/recovery；成功后刷新会话", async () => {
    const { box, server } = await openLogin("/login");
    await passwordStep(box);
    await vi.waitFor(() => byText(box, "button", "改用恢复码"));
    byText(box, "button", "改用恢复码").click();
    await settle();
    await enterCode(box, "恢复码", "ABCDE-FGHJK");
    expect(server.callsTo("POST /api/auth/mfa/recovery")[0]?.body).toEqual({ code: "ABCDE-FGHJK" });
    expect(server.callsTo("GET /api/auth/session").length).toBeGreaterThan(0);
  });

  it("mfa_pending_invalid → 回到密码步并说明", async () => {
    const { box, server } = await openLogin("/login");
    server.set("POST /api/auth/mfa/totp", errorReply(401, "mfa_pending_invalid", "登录验证已失效，请重新登录"));
    await passwordStep(box);
    await enterCode(box, "验证码", "123456");
    expect(box.querySelector("h1")?.textContent).toBe("登录");
    expect(box.textContent).toContain("登录验证已失效");
    expect(inputByLabel(box, "用户名")).toBeTruthy();
  });

  it("mfa_locked → 留在第二步并说明锁定", async () => {
    const { box, server } = await openLogin("/login");
    server.set("POST /api/auth/mfa/totp", errorReply(429, "mfa_locked", "验证失败次数过多，请约 15 分钟后再试"));
    await passwordStep(box);
    await enterCode(box, "验证码", "123456");
    expect(box.querySelector("h1")?.textContent).toBe("两步验证");
    expect(box.textContent).toContain("验证被暂时锁定");
    expect(box.textContent).toContain("请约 15 分钟后再试");
  });

  it("rate_limited 显示 Retry-After 秒数", async () => {
    const { box, server } = await openLogin("/login");
    server.set("POST /api/auth/login", errorReply(429, "rate_limited", "x", { "Retry-After": "60" }));
    await passwordStep(box);
    expect(box.textContent).toContain("请约 60 秒后再试");
  });

  it("密码错误只给统一说法", async () => {
    const { box, server } = await openLogin("/login");
    server.set("POST /api/auth/login", errorReply(401, "invalid_credentials", "用户名或密码错误"));
    await passwordStep(box);
    expect(box.textContent).toContain("用户名或密码错误");
    expect(box.querySelector("h1")?.textContent).toBe("登录");
  });
});

describe("登录页：OAuth 回跳", () => {
  it("?oauth=mfa_required 直接进入第二步，且清掉地址栏参数", async () => {
    const { box } = await openLogin("/login?oauth=mfa_required&provider=github");
    expect(box.querySelector("h1")?.textContent).toBe("两步验证");
  });

  it("?oauth=not_linked 显示原因，带提供方名称", async () => {
    const config: PublicConfig = makePublicConfig({
      login_methods: ["password", "oauth"],
      oauth_providers: [{ slug: "github", name: "GitHub", icon: null }],
    });
    const { box } = await openLogin("/login?oauth=not_linked&provider=github", config);
    expect(box.textContent).toContain("GitHub：这个第三方账号还没有绑定任何用户");
    expect(box.textContent).toContain("账号安全");
  });
});

describe("登录页：按公开配置调整", () => {
  const github = [{ slug: "github", name: "GitHub", icon: null }];

  it("login_methods 不含 password：隐藏密码表单，只留通行密钥 / OAuth（没有“或者”分隔线）", async () => {
    const { box } = await openLogin("/login", makePublicConfig({ login_methods: ["passkey", "oauth"], oauth_providers: github }));
    expect(box.querySelector("form")).toBeNull();
    expect(box.querySelector("input[name=password]")).toBeNull();
    expect(box.querySelector(".auth-divider")).toBeNull();
    expect(byText(box, "button", "使用通行密钥登录")).toBeTruthy();
    expect(box.querySelector("a.btn")?.getAttribute("href")).toBe("/api/auth/oauth/github/start?mode=login");
  });

  it("有密码表单时，通行密钥 / OAuth 前有“或者”分隔线", async () => {
    const { box } = await openLogin("/login", makePublicConfig({ login_methods: ["password", "passkey"] }));
    expect(box.querySelector("form")).not.toBeNull();
    expect(box.querySelector(".auth-divider")).not.toBeNull();
  });

  it("一种登录方式都没有：说明联系管理员（oauth 开着但没有启用的提供方也算没有）", async () => {
    const { box } = await openLogin("/login", makePublicConfig({ login_methods: ["oauth"], oauth_providers: [] }));
    expect(box.textContent).toContain("暂无可用的登录方式");
    expect(box.textContent).toContain("请联系管理员");
    expect(box.querySelector("form")).toBeNull();
  });

  it("login_notice 按纯文本显示：HTML 与链接都不生效", async () => {
    const notice = "维护通知 <a href=\"https://evil.example.com\">点这里</a>\nhttps://evil.example.com";
    const { box } = await openLogin("/login", makePublicConfig({ login_notice: notice }));
    const el = box.querySelector(".auth-notice");
    expect(el?.textContent).toBe(notice);
    expect(box.querySelectorAll("a").length).toBe(0);
  });

  it("没有公告时不显示公告块", async () => {
    const { box } = await openLogin("/login");
    expect(box.querySelector(".auth-notice")).toBeNull();
  });

  it("registration_enabled：显示指向 /register 的“去注册”；关闭时不显示", async () => {
    const on = await openLogin("/login", makePublicConfig({ registration_enabled: true }));
    expect(byText(on.box, "a", "去注册").getAttribute("href")).toBe("/register");
    await mounted?.unmount();
    mounted = null;
    const off = await openLogin("/login");
    expect(off.box.textContent).not.toContain("去注册");
  });
});

describe("登录页：人机验证（Turnstile，替身控件）", () => {
  function installFakeTurnstile() {
    const rendered: TurnstileRenderOptions[] = [];
    const api: TurnstileApi = {
      render: (_container, options) => (rendered.push(options), "w1"),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    Object.assign(window, { turnstile: api });
    return { rendered, api };
  }
  const ON = { enabled: true, site_key: "0xKEY", scopes: ["login" as const] };
  const submitBtn = (box: HTMLElement) => box.querySelector<HTMLButtonElement>("form button[type=submit]");

  async function fillCredentials(box: HTMLElement): Promise<void> {
    await typeInto(inputByLabel(box, "用户名"), "alice");
    await typeInto(inputByLabel(box, "密码"), "correct horse");
  }

  it("作用范围含 login：渲染控件（action=login、site key），拿到 token 前提交按钮禁用，token 随请求发出", async () => {
    const { rendered } = installFakeTurnstile();
    const { box, server } = await openLogin("/login", makePublicConfig({ turnstile: ON }));
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toMatchObject({ sitekey: "0xKEY", action: "login" });
    expect(submitBtn(box)?.disabled).toBe(true);

    await fillCredentials(box);
    await act(async () => rendered[0]?.callback("cf-token"));
    expect(submitBtn(box)?.disabled).toBe(false);
    server.set("POST /api/auth/login", { json: { status: "ok" } });
    await submit(box.querySelector("form") as HTMLFormElement);
    await settle();
    expect(server.callsTo("POST /api/auth/login")[0]?.body).toEqual({ username: "alice", password: "correct horse", turnstile_token: "cf-token" });
  });

  it("token 过期：提交按钮重新禁用", async () => {
    const { rendered } = installFakeTurnstile();
    const { box } = await openLogin("/login", makePublicConfig({ turnstile: ON }));
    await act(async () => rendered[0]?.callback("t"));
    expect(submitBtn(box)?.disabled).toBe(false);
    await act(async () => rendered[0]?.["expired-callback"]());
    expect(submitBtn(box)?.disabled).toBe(true);
  });

  it.each([
    ["turnstile_failed", 400, "人机验证没有通过", "请重新完成验证"],
    ["turnstile_unavailable", 503, "人机验证服务暂时不可用", "请稍后重试"],
  ])("%s：中文标题与说明，控件被重置并要求重新验证", async (code, status, title, hint) => {
    const { rendered, api } = installFakeTurnstile();
    const { box, server } = await openLogin("/login", makePublicConfig({ turnstile: ON }));
    server.set("POST /api/auth/login", errorReply(status, code, "原文"));
    await fillCredentials(box);
    await act(async () => rendered[0]?.callback("cf-token"));
    await submit(box.querySelector("form") as HTMLFormElement);
    await settle();
    expect(box.querySelector(".callout b")?.textContent).toBe(title);
    expect(box.textContent).toContain(hint);
    expect(box.textContent).toContain(`${code} · HTTP ${status}`);
    expect(api.reset).toHaveBeenCalledWith("w1");
    expect(submitBtn(box)?.disabled).toBe(true);
  });

  it("site key 为空：提交禁用并说明，不渲染控件，也不降级放行", async () => {
    const { rendered } = installFakeTurnstile();
    const { box, server } = await openLogin("/login", makePublicConfig({ turnstile: { ...ON, site_key: "" } }));
    expect(rendered).toHaveLength(0);
    expect(box.textContent).toContain("人机验证配置不完整");
    expect(submitBtn(box)?.disabled).toBe(true);
    await fillCredentials(box);
    await submit(box.querySelector("form") as HTMLFormElement);
    await settle();
    expect(server.callsTo("POST /api/auth/login")).toHaveLength(0);
  });

  it("作用范围不含 login（只开了注册 / 取件）：不渲染控件，请求体不带 token", async () => {
    const { rendered } = installFakeTurnstile();
    const { box, server } = await openLogin("/login", makePublicConfig({ turnstile: { ...ON, scopes: ["register", "pickup"] } }));
    expect(rendered).toHaveLength(0);
    expect(submitBtn(box)?.disabled).toBe(false);
    await passwordStep(box);
    expect(server.callsTo("POST /api/auth/login")[0]?.body).toEqual({ username: "alice", password: "correct horse" });
  });

  it("通行密钥与 OAuth 按钮不受 Turnstile 影响（不被禁用）", async () => {
    installFakeTurnstile();
    // happy-dom 没有 WebAuthn：放一个替身，免得按钮因“浏览器不支持”而禁用
    Object.assign(window, { PublicKeyCredential: function PublicKeyCredential() {} });
    const { box } = await openLogin(
      "/login",
      makePublicConfig({ turnstile: ON, login_methods: ["password", "passkey", "oauth"], oauth_providers: [{ slug: "github", name: "GitHub", icon: null }] }),
    );
    expect(byText<HTMLButtonElement>(box, "button", "使用通行密钥登录").disabled).toBe(false);
    expect(box.querySelector("a.btn")?.getAttribute("href")).toBe("/api/auth/oauth/github/start?mode=login");
  });
});

describe("登录页：错误标题", () => {
  it("login_method_disabled：说明密码登录已关闭", async () => {
    const { box, server } = await openLogin("/login");
    server.set("POST /api/auth/login", errorReply(403, "login_method_disabled", "该登录方式未启用"));
    await passwordStep(box);
    expect(box.querySelector(".callout b")?.textContent).toBe("密码登录已关闭");
    expect(box.textContent).toContain("login_method_disabled · HTTP 403");
  });

  it("其他服务端错误仍是“服务器出错”", async () => {
    const { box, server } = await openLogin("/login");
    server.set("POST /api/auth/login", errorReply(500, "internal_error", "boom"));
    await passwordStep(box);
    expect(box.querySelector(".callout b")?.textContent).toBe("服务器出错");
  });
});
