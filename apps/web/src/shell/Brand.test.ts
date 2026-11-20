// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { PublicConfig, SessionUser } from "@maillink/shared";
import { queryKeys } from "../api/queries";
import { settle } from "../test/dom";
import { makePublicConfig } from "../test/fixtures";
import { mount } from "../test/render";
import type { Mounted } from "../test/render";
import { AuthLayout } from "./AuthShell";
import { logoSource } from "./brand-logo";
import { PickupShell } from "./PickupShell";
import { SidebarContent } from "./Sidebar";

const DATA_LOGO = "data:image/png;base64,AAAA";
const HTTPS_LOGO = "https://cdn.example.com/logo.png";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

async function render(config: PublicConfig, element: ReturnType<typeof createElement>): Promise<HTMLElement> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.publicConfig, config);
  mounted = await mount(createElement(QueryClientProvider, { client }, element));
  return mounted.container;
}

const authPage = (config: Partial<PublicConfig>) => render(makePublicConfig(config), createElement(AuthLayout, null, createElement("h1", null, "登录")));

describe("logoSource：按场景筛选可渲染的 Logo", () => {
  it("认证页 / 工作区：data:image 与 https 都接受", () => {
    expect(logoSource(DATA_LOGO, "app")).toBe(DATA_LOGO);
    expect(logoSource(HTTPS_LOGO, "app")).toBe(HTTPS_LOGO);
  });

  it("其他协议与空值不渲染", () => {
    for (const bad of ["", undefined, "http://cdn.example.com/a.png", "javascript:alert(1)", "data:text/html;base64,AAAA", "//cdn.example.com/a.png", "ftp://x/a.png", "not a url", "blob:https://x/1"]) {
      expect(logoSource(bad, "app"), String(bad)).toBeUndefined();
    }
  });

  it("取件页：只接受 data:image，https 不行（取件页不加载第三方资源）", () => {
    expect(logoSource(DATA_LOGO, "pickup")).toBe(DATA_LOGO);
    expect(logoSource(HTTPS_LOGO, "pickup")).toBeUndefined();
    expect(logoSource("http://cdn.example.com/a.png", "pickup")).toBeUndefined();
    expect(logoSource("", "pickup")).toBeUndefined();
  });
});

describe("认证页外壳：站点信息", () => {
  it("显示 Logo（带 alt、no-referrer）、站点名、描述与页脚", async () => {
    const root = await authPage({ site_name: "星河", site_logo: DATA_LOGO, site_description: "安全取件", site_footer: "© 2026 星河" });
    const img = root.querySelector<HTMLImageElement>(".auth-brand img");
    expect(img?.getAttribute("src")).toBe(DATA_LOGO);
    expect(img?.getAttribute("alt")).toBe("星河 Logo");
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(root.querySelector(".auth-brand .brand-name")?.textContent).toBe("星河");
    expect(root.querySelector(".auth-desc")?.textContent).toBe("安全取件");
    expect(root.querySelector(".auth-footer")?.textContent).toBe("© 2026 星河");
  });

  it("https Logo 在认证页显示；http / javascript: 回退默认图标", async () => {
    let root = await authPage({ site_logo: HTTPS_LOGO });
    expect(root.querySelector(".auth-brand img")?.getAttribute("src")).toBe(HTTPS_LOGO);
    await mounted?.unmount();
    for (const bad of ["http://cdn.example.com/a.png", "javascript:alert(1)"]) {
      root = await authPage({ site_logo: bad });
      expect(root.querySelector(".auth-brand img")).toBeNull();
      expect(root.querySelector(".auth-brand .brand-mark svg")).not.toBeNull();
      await mounted?.unmount();
    }
  });

  it("没有设置时：默认图标，不渲染空的描述与页脚", async () => {
    const root = await authPage({ site_logo: "", site_description: "", site_footer: "" });
    expect(root.querySelector(".auth-brand .brand-mark")).not.toBeNull();
    expect(root.querySelector(".auth-desc")).toBeNull();
    expect(root.querySelector(".auth-footer")).toBeNull();
  });

  it("Logo 加载失败：回退默认图标，不留破图", async () => {
    const root = await authPage({ site_logo: HTTPS_LOGO });
    const img = root.querySelector("img");
    if (!img) throw new Error("没有 img");
    await act(async () => {
      img.dispatchEvent(new Event("error"));
    });
    expect(root.querySelector(".auth-brand img")).toBeNull();
    expect(root.querySelector(".auth-brand .brand-mark svg")).not.toBeNull();
  });

  it("全部按纯文本渲染：名称、描述、页脚里的标签不生效", async () => {
    const root = await authPage({ site_name: "<b>名</b>", site_description: "<img src=x onerror=alert(1)>", site_footer: "<script>x</script>" });
    expect(root.querySelector(".brand-name b")).toBeNull();
    expect(root.querySelector(".brand-name")?.textContent).toBe("<b>名</b>");
    expect(root.querySelector(".auth-desc img")).toBeNull();
    expect(root.querySelector(".auth-desc")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector(".auth-footer")?.textContent).toBe("<script>x</script>");
  });
});

describe("工作区侧栏：站点信息", () => {
  const user: SessionUser = { id: 1, username: "root", display_name: null, email: null, role: "admin" };
  async function sidebar(config: Partial<PublicConfig>): Promise<HTMLElement> {
    const rootRoute = createRootRoute({ component: () => createElement(SidebarContent, { user, loggingOut: false, onLogout: () => undefined }) });
    const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });
    const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]), history: createMemoryHistory({ initialEntries: ["/"] }) });
    await router.load();
    const root = await render(makePublicConfig(config), createElement(RouterProvider, { router }));
    await settle();
    return root;
  }

  it("品牌区显示 Logo 与站点名，页脚文字在侧栏底部用户块里", async () => {
    const root = await sidebar({ site_name: "星河", site_logo: HTTPS_LOGO, site_footer: "客服 support@example.com" });
    expect(root.querySelector(".brand img")?.getAttribute("src")).toBe(HTTPS_LOGO);
    expect(root.querySelector(".brand-name")?.textContent).toBe("星河");
    expect(root.querySelector(".sidebar-foot .sidebar-note")?.textContent).toBe("客服 support@example.com");
  });

  it("页脚为空不渲染", async () => {
    const root = await sidebar({ site_footer: "" });
    expect(root.querySelector(".sidebar-note")).toBeNull();
  });
});

describe("取件页外壳：只显示 data URI 形式的 Logo（共用 logoSource，不被认证页的放宽影响）", () => {
  const pickup = async (logo: string) => render(makePublicConfig({ site_logo: HTTPS_LOGO }), createElement(PickupShell, { brand: { name: "店", logo }, children: createElement("div") }));

  it("data URI 显示；https / http 不显示；无论站点配置里的 Logo 是什么", async () => {
    let root = await pickup(DATA_LOGO);
    expect(root.querySelector(".pk-brand img")?.getAttribute("src")).toBe(DATA_LOGO);
    expect(root.querySelector(".pk-brand img")?.getAttribute("referrerpolicy")).toBe("no-referrer");
    await mounted?.unmount();
    for (const other of [HTTPS_LOGO, "http://cdn.example.com/a.png"]) {
      root = await pickup(other);
      expect(root.querySelector(".pk-brand img")).toBeNull();
      expect(root.querySelector(".pk-brand .brand-mark")).not.toBeNull();
      await mounted?.unmount();
    }
  });
});
