// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResponse } from "@maillink/shared";
import { queryKeys } from "../../api/queries";
import { createAppRouter } from "../../app/router";
import { click, mount, typeInto } from "../../test/render";
import type { Mounted } from "../../test/render";
import { errorResponse, publicConfig, stubFetch } from "../../test/http-stub";
import { waitUntil } from "../../test/wait";
import type { TurnstileApi, TurnstileRenderOptions } from "../turnstile/loader";

const NEW_USER_SESSION: SessionResponse = {
  user: { id: 9, username: "newbie", display_name: null, email: null, role: "user" },
  auth_methods: ["password"],
  expires_at: 4_000_000_000,
};

let mounted: Mounted | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "turnstile");
});

async function openRegister() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.setupStatus, { needs_setup: false });
  client.setQueryData(queryKeys.session, null);
  const router = createAppRouter({ client, history: createMemoryHistory({ initialEntries: ["/register"] }) });
  mounted = await mount(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router })));
  return { router, container: mounted.container };
}

const input = (container: HTMLElement, name: string) => container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
const submitButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('button[type="submit"]');

async function fillAndSubmit(container: HTMLElement, values: { username: string; password: string; email?: string }) {
  await typeInto(input(container, "username") as HTMLInputElement, values.username);
  await typeInto(input(container, "password") as HTMLInputElement, values.password);
  if (values.email) await typeInto(input(container, "email") as HTMLInputElement, values.email);
  await click(submitButton(container) as HTMLButtonElement);
}

describe("注册页", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("注册关闭时显示“未开放注册”，没有表单", async () => {
    stubFetch({ "GET /api/public/config": publicConfig({ registration_enabled: false }) });
    const { container } = await openRegister();
    await waitUntil(() => container.textContent?.includes("未开放注册") === true, "出现未开放注册");
    expect(container.querySelector("form")).toBeNull();
  });

  it("注册成功即已登录：提交用户名密码（邮箱留空不带），刷新会话后跳到首页（用户 → /inbox）", async () => {
    const { requests } = stubFetch({
      "GET /api/public/config": publicConfig(),
      "POST /api/auth/register": () => new Response(JSON.stringify({ status: "ok" }), { status: 201, headers: { "Content-Type": "application/json" } }),
      "GET /api/auth/session": NEW_USER_SESSION,
    });
    const { router, container } = await openRegister();
    await waitUntil(() => input(container, "username") !== null, "出现注册表单");
    await fillAndSubmit(container, { username: "newbie", password: "long-enough-password" });
    await waitUntil(() => router.state.location.pathname === "/inbox", "跳转到 /inbox");
    const register = requests.find((request) => request.path === "/api/auth/register");
    expect(register?.body).toEqual({ username: "newbie", password: "long-enough-password" });
  });

  it("客户端校验：用户名太短、密码太短在字段下提示，不发请求", async () => {
    const { requests } = stubFetch({ "GET /api/public/config": publicConfig() });
    const { container } = await openRegister();
    await waitUntil(() => input(container, "username") !== null, "出现注册表单");
    await fillAndSubmit(container, { username: "ab", password: "short" });
    expect(container.textContent).toContain("用户名至少 3 个字符");
    expect(container.textContent).toContain("密码至少 10 个字符");
    expect(requests.some((request) => request.path === "/api/auth/register")).toBe(false);
  });

  it("username_taken 在用户名字段下就地显示", async () => {
    stubFetch({
      "GET /api/public/config": publicConfig(),
      "POST /api/auth/register": () => errorResponse(409, "username_taken", "用户名已被使用"),
    });
    const { container } = await openRegister();
    await waitUntil(() => input(container, "username") !== null, "出现注册表单");
    await fillAndSubmit(container, { username: "taken", password: "long-enough-password" });
    await waitUntil(() => container.querySelector(".field-error") !== null, "出现字段错误");
    expect(container.querySelector(".field-error")?.textContent).toBe("用户名已被使用");
  });

  it("提交时才发现已关闭（后端 404）：换成未开放状态", async () => {
    stubFetch({
      "GET /api/public/config": publicConfig(),
      "POST /api/auth/register": () => errorResponse(404, "not_found", "Not Found"),
    });
    const { container } = await openRegister();
    await waitUntil(() => input(container, "username") !== null, "出现注册表单");
    await fillAndSubmit(container, { username: "newbie", password: "long-enough-password" });
    await waitUntil(() => container.textContent?.includes("未开放注册") === true, "出现未开放注册");
  });
});

describe("注册页的人机验证", () => {
  function installFakeTurnstile() {
    const rendered: TurnstileRenderOptions[] = [];
    const api: TurnstileApi = {
      render: (_container, options) => {
        rendered.push(options);
        return "w1";
      },
      reset: vi.fn(),
      remove: vi.fn(),
    };
    Object.assign(window, { turnstile: api });
    return { rendered, api };
  }

  const TURNSTILE_ON = { enabled: true, site_key: "0xKEY", scopes: ["register" as const] };

  it("作用范围含 register：渲染控件（action=register），拿到 token 前不能提交，token 随请求发出", async () => {
    const { rendered } = installFakeTurnstile();
    const { requests } = stubFetch({
      "GET /api/public/config": publicConfig({ turnstile: TURNSTILE_ON }),
      "POST /api/auth/register": () => new Response(JSON.stringify({ status: "ok" }), { status: 201, headers: { "Content-Type": "application/json" } }),
      "GET /api/auth/session": NEW_USER_SESSION,
    });
    const { container } = await openRegister();
    await waitUntil(() => rendered.length === 1, "渲染 Turnstile 控件");
    expect(rendered[0]).toMatchObject({ sitekey: "0xKEY", action: "register" });
    expect(submitButton(container)?.disabled).toBe(true);

    act(() => rendered[0]?.callback("cf-token"));
    expect(submitButton(container)?.disabled).toBe(false);
    await fillAndSubmit(container, { username: "newbie", password: "long-enough-password", email: "n@example.com" });
    await waitUntil(() => requests.some((request) => request.path === "/api/auth/register"), "发出注册请求");
    expect(requests.find((request) => request.path === "/api/auth/register")?.body).toEqual({
      username: "newbie", password: "long-enough-password", email: "n@example.com", turnstile_token: "cf-token",
    });
  });

  it("turnstile_failed：显示中文说明，控件被重置，需重新验证", async () => {
    const { rendered, api } = installFakeTurnstile();
    stubFetch({
      "GET /api/public/config": publicConfig({ turnstile: TURNSTILE_ON }),
      "POST /api/auth/register": () => errorResponse(400, "turnstile_failed", "人机验证失败"),
    });
    const { container } = await openRegister();
    await waitUntil(() => rendered.length === 1, "渲染 Turnstile 控件");
    act(() => rendered[0]?.callback("bad-token"));
    await fillAndSubmit(container, { username: "newbie", password: "long-enough-password" });
    await waitUntil(() => container.textContent?.includes("人机验证没有通过") === true, "出现中文错误说明");
    expect(container.textContent).toContain("turnstile_failed · HTTP 400");
    expect(api.reset).toHaveBeenCalledWith("w1");
    expect(submitButton(container)?.disabled).toBe(true);
  });

  it("范围不含 register 时不渲染控件、也不加载脚本", async () => {
    const { rendered } = installFakeTurnstile();
    stubFetch({ "GET /api/public/config": publicConfig({ turnstile: { enabled: true, site_key: "k", scopes: ["login"] } }) });
    const { container } = await openRegister();
    await waitUntil(() => input(container, "username") !== null, "出现注册表单");
    expect(rendered).toHaveLength(0);
    expect(container.querySelector('[data-testid="turnstile-container"]')).toBeNull();
  });
});
