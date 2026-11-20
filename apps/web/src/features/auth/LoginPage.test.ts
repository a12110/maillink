// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicConfig } from "@maillink/shared";
import { queryKeys } from "../../api/queries";
import { createAppRouter } from "../../app/router";
import { byText, inputByLabel, settle, submit } from "../../test/dom";
import { errorReply, installFakeFetch } from "../../test/fake-fetch";
import type { FakeFetch } from "../../test/fake-fetch";
import { mount, typeInto } from "../../test/render";
import type { Mounted } from "../../test/render";
import { ToastProvider } from "../../ui";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const CONFIG: PublicConfig = { site_name: "MailLink", registration_enabled: false, login_methods: ["password"], oauth_providers: [] };
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
    const config: PublicConfig = {
      ...CONFIG,
      login_methods: ["password", "oauth"],
      oauth_providers: [{ slug: "github", name: "GitHub", icon: null }],
    };
    const { box } = await openLogin("/login?oauth=not_linked&provider=github", config);
    expect(box.textContent).toContain("GitHub：这个第三方账号还没有绑定任何用户");
    expect(box.textContent).toContain("账号安全");
  });
});
