// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicConfigQuery } from "../../api/queries";
import { click, mount, typeInto } from "../../test/render";
import type { Mounted } from "../../test/render";
import { errorResponse, publicConfig, stubFetch } from "../../test/http-stub";
import type { RecordedRequest } from "../../test/http-stub";
import { waitUntil } from "../../test/wait";
import { ThemeControllerProvider } from "../../theme";
import type { ThemeController } from "../../theme";
import { ToastProvider } from "../../ui";
import { AppearanceForm } from "./AppearanceForm";
import { AuthForm } from "./AuthForm";
import { TurnstileForm } from "./TurnstileForm";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

function fakeController() {
  const preview = vi.fn<ThemeController["preview"]>();
  const update = vi.fn<ThemeController["update"]>();
  return { controller: { preview, update } satisfies ThemeController, preview, update };
}

async function mountForm(element: ReactElement, controller: ThemeController = fakeController().controller) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(publicConfigQuery().queryKey, publicConfig());
  mounted = await mount(
    createElement(QueryClientProvider, { client }, createElement(ThemeControllerProvider, { value: controller }, createElement(ToastProvider, null, element))),
  );
  return { container: mounted.container, client };
}

const button = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim().startsWith(label)) as HTMLButtonElement;
const field = (container: HTMLElement, name: string) => container.querySelector<HTMLInputElement>(`input[name="${name}"]`) as HTMLInputElement;
const radio = (container: HTMLElement, name: string, value: string) =>
  container.querySelector<HTMLInputElement>(`input[type="radio"][name="${name}"][value="${value}"]`) as HTMLInputElement;

const APPEARANCE = { preset: "default", accent: "#2f5fa8", mode: "light", radius: "4" };

describe("外观：实时预览，未保存可撤销", () => {
  it("改明暗 / 强调色即时预览；撤销回到已保存值；离开页面清除预览", async () => {
    const { controller, preview } = fakeController();
    stubFetch({ "GET /api/admin/settings/appearance": APPEARANCE });
    const { container } = await mountForm(createElement(AppearanceForm), controller);
    await waitUntil(() => container.querySelector('input[name="accent"]') !== null, "表单加载完成");
    expect(preview).toHaveBeenLastCalledWith({ mode: "light", radius: "4", accent: "#2f5fa8" });

    await click(radio(container, "mode", "dark"));
    expect(preview).toHaveBeenLastCalledWith({ mode: "dark", radius: "4", accent: "#2f5fa8" });
    await typeInto(field(container, "accent"), "#1f7a5a");
    expect(preview).toHaveBeenLastCalledWith({ mode: "dark", radius: "4", accent: "#1f7a5a" });
    expect(container.textContent).toContain("未保存 2 处");

    await click(button(container, "撤销修改"));
    expect(preview).toHaveBeenLastCalledWith({ mode: "light", radius: "4", accent: "#2f5fa8" });
    expect(container.textContent).not.toContain("未保存");

    await mounted?.unmount();
    mounted = null;
    expect(preview).toHaveBeenLastCalledWith(null);
  });

  it("输入到一半的无效颜色不影响页面主题；过浅的颜色提示已被自动调整", async () => {
    const { controller, preview } = fakeController();
    stubFetch({ "GET /api/admin/settings/appearance": APPEARANCE });
    const { container } = await mountForm(createElement(AppearanceForm), controller);
    await waitUntil(() => container.querySelector('input[name="accent"]') !== null, "表单加载完成");

    await typeInto(field(container, "accent"), "#ff");
    expect(preview).toHaveBeenLastCalledWith({ mode: "light", radius: "4", accent: "#2f5fa8" });
    expect(container.textContent).toContain("输入完整的 #rrggbb");

    await typeInto(field(container, "accent"), "#ffff00");
    expect(container.textContent).toContain("已自动调整为");
  });

  it("保存：PUT 整组；成功后公开配置缓存里的外观与保存值一致", async () => {
    const { requests } = stubFetch({
      "GET /api/admin/settings/appearance": APPEARANCE,
      "PUT /api/admin/settings/appearance": (request: RecordedRequest) => new Response(JSON.stringify(request.body), { headers: { "Content-Type": "application/json" } }),
      "GET /api/public/config": publicConfig(),
    });
    const { container, client } = await mountForm(createElement(AppearanceForm));
    await waitUntil(() => container.querySelector('input[name="accent"]') !== null, "表单加载完成");
    await click(radio(container, "radius", "8"));
    await click(button(container, "保存"));
    await waitUntil(() => requests.some((request) => request.method === "PUT"), "发出保存请求");
    expect(requests.find((request) => request.method === "PUT")?.body).toEqual({ ...APPEARANCE, radius: "8" });
    await waitUntil(() => client.getQueryData(publicConfigQuery().queryKey)?.appearance.radius === "8", "公开配置缓存同步");
  });

  it("服务端 accent_unreachable 就地显示中文说明与错误码", async () => {
    stubFetch({
      "GET /api/admin/settings/appearance": APPEARANCE,
      "PUT /api/admin/settings/appearance": () => errorResponse(400, "accent_unreachable", "强调色 #123456 无法保证按钮与文字的对比度"),
    });
    const { container } = await mountForm(createElement(AppearanceForm));
    await waitUntil(() => container.querySelector('input[name="accent"]') !== null, "表单加载完成");
    await click(radio(container, "mode", "dark"));
    await click(button(container, "保存"));
    await waitUntil(() => container.textContent?.includes("accent_unreachable") === true, "出现错误提示");
    expect(container.textContent).toContain("无法保证按钮与文字的清晰度");
    expect(container.textContent).toContain("HTTP 400");
  });
});

describe("人机验证：secret 留空表示不改", () => {
  const SAVED = { enabled: false, site_key: "", secret_set: true, scopes: [] };

  it("secret 留空时请求体不含 secret，显示“已设置”；填写后才带上", async () => {
    const { requests } = stubFetch({
      "GET /api/admin/settings/turnstile": SAVED,
      "PUT /api/admin/settings/turnstile": () => new Response(JSON.stringify({ ...SAVED, site_key: "0xKEY" }), { headers: { "Content-Type": "application/json" } }),
      "GET /api/public/config": publicConfig(),
    });
    const { container } = await mountForm(createElement(TurnstileForm));
    await waitUntil(() => container.querySelector('input[name="site_key"]') !== null, "表单加载完成");
    expect(container.textContent).toContain("Secret 已设置");
    expect(field(container, "secret").placeholder).toContain("留空表示不修改");

    await typeInto(field(container, "site_key"), "0xKEY");
    await click(button(container, "保存"));
    await waitUntil(() => requests.some((request) => request.method === "PUT"), "发出保存请求");
    expect(requests.find((request) => request.method === "PUT")?.body).toEqual({ enabled: false, site_key: "0xKEY", scopes: [] });

    await typeInto(field(container, "secret"), "new-secret");
    await typeInto(field(container, "site_key"), "0xKEY2");
    await click(button(container, "保存"));
    await waitUntil(() => requests.filter((request) => request.method === "PUT").length === 2, "第二次保存");
    expect(requests.filter((request) => request.method === "PUT")[1]?.body).toEqual({ enabled: false, site_key: "0xKEY2", scopes: [], secret: "new-secret" });
  });

  it("turnstile_incomplete 给出中文说明", async () => {
    stubFetch({
      "GET /api/admin/settings/turnstile": SAVED,
      "PUT /api/admin/settings/turnstile": () => errorResponse(400, "turnstile_incomplete", "启用 Turnstile 需要填写 site key"),
    });
    const { container } = await mountForm(createElement(TurnstileForm));
    await waitUntil(() => container.querySelector('input[name="site_key"]') !== null, "表单加载完成");
    await click(container.querySelector('input[type="checkbox"]') as HTMLInputElement);
    await click(button(container, "保存"));
    await waitUntil(() => container.textContent?.includes("turnstile_incomplete") === true, "出现错误提示");
    expect(container.textContent).toContain("启用人机验证前要先填完整");
  });
});

describe("注册与登录：锁死保护的错误说明", () => {
  it("login_methods_lockout 说明会把管理员锁在系统外", async () => {
    stubFetch({
      "GET /api/admin/settings/auth": { registration_enabled: false, login_methods: ["password", "passkey"], oauth_require_2fa: false },
      "PUT /api/admin/settings/auth": () => errorResponse(400, "login_methods_lockout", "按此设置没有任何启用的管理员还能登录"),
    });
    const { container } = await mountForm(createElement(AuthForm));
    await waitUntil(() => container.querySelector('input[type="checkbox"]') !== null, "表单加载完成");
    const passwordBox = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((box) => box.closest("label")?.textContent === "密码");
    await click(passwordBox as HTMLInputElement);
    await click(button(container, "保存"));
    await waitUntil(() => container.textContent?.includes("login_methods_lockout") === true, "出现错误提示");
    expect(container.textContent).toContain("锁在系统外");
  });

  it("至少保留一种登录方式：全部取消时就地提示，不发请求", async () => {
    const { requests } = stubFetch({
      "GET /api/admin/settings/auth": { registration_enabled: false, login_methods: ["password"], oauth_require_2fa: false },
    });
    const { container } = await mountForm(createElement(AuthForm));
    await waitUntil(() => container.querySelector('input[type="checkbox"]') !== null, "表单加载完成");
    const passwordBox = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((box) => box.closest("label")?.textContent === "密码");
    await click(passwordBox as HTMLInputElement);
    await click(button(container, "保存"));
    expect(container.textContent).toContain("至少保留一种登录方式");
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
  });
});
