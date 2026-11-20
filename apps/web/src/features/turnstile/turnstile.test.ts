// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mount } from "../../test/render";
import type { Mounted } from "../../test/render";
import { createTurnstileLoader, TURNSTILE_SCRIPT_URL } from "./loader";
import type { ScriptDocument, ScriptLike, TurnstileApi, TurnstileRenderOptions } from "./loader";
import { TurnstileWidget } from "./TurnstileWidget";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

function fakeApi() {
  const rendered: TurnstileRenderOptions[] = [];
  const api: TurnstileApi = {
    render: vi.fn((_container, options) => {
      rendered.push(options);
      return `widget-${rendered.length}`;
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  return { api, rendered };
}

const flush = () => act(async () => { await Promise.resolve(); });

/** 脚本与文档的替身：不真的去加载外部脚本，由测试决定 onload / onerror */
function fakeDocument() {
  const attached: ScriptLike[] = [];
  const document: ScriptDocument = {
    createScript: () => {
      const script: ScriptLike = {
        src: "", async: false, defer: false, onload: null, onerror: null,
        setAttribute: () => undefined,
        remove: () => void attached.splice(attached.indexOf(script), 1),
      };
      return script;
    },
    append: (script) => void attached.push(script),
  };
  return { document, attached };
}

describe("createTurnstileLoader：按需、显式渲染、只插入一次", () => {
  it("没有调用就不会插入脚本；并发调用只插入一个脚本，onload 后都拿到同一个 api", async () => {
    const holder: { api?: TurnstileApi } = {};
    const { document, attached } = fakeDocument();
    const loader = createTurnstileLoader({ document, readGlobal: () => holder.api });
    expect(attached).toHaveLength(0);

    const first = loader();
    const second = loader();
    expect(attached).toHaveLength(1);
    expect(attached[0]?.src).toBe(TURNSTILE_SCRIPT_URL);
    expect(TURNSTILE_SCRIPT_URL).toContain("render=explicit");

    const { api } = fakeApi();
    holder.api = api;
    attached[0]?.onload?.(new Event("load"));
    expect(await first).toBe(api);
    expect(await second).toBe(api);
  });

  it("api 已存在时不再插入脚本", async () => {
    const { api } = fakeApi();
    const { document, attached } = fakeDocument();
    expect(await createTurnstileLoader({ document, readGlobal: () => api })()).toBe(api);
    expect(attached).toHaveLength(0);
  });

  it("脚本加载失败：拒绝并移除节点，再次调用会重新插入（可重试）", async () => {
    const { document, attached } = fakeDocument();
    const loader = createTurnstileLoader({ document, readGlobal: () => undefined });
    const failing = loader();
    attached[0]?.onerror?.(new Event("error"));
    await expect(failing).rejects.toThrow("无法加载 Cloudflare Turnstile 脚本");
    expect(attached).toHaveLength(0);
    void loader();
    expect(attached).toHaveLength(1);
  });

  it("脚本已加载但没有 turnstile 对象：报错，不静默", async () => {
    const { document, attached } = fakeDocument();
    const loader = createTurnstileLoader({ document, readGlobal: () => undefined });
    const pending = loader();
    attached[0]?.onload?.(new Event("load"));
    await expect(pending).rejects.toThrow("没有提供 turnstile 对象");
  });
});

describe("TurnstileWidget", () => {
  it("用 sitekey 与 action 显式渲染；callback 给出 token，过期 / 超时给 null", async () => {
    const { api, rendered } = fakeApi();
    const onToken = vi.fn();
    mounted = await mount(createElement(TurnstileWidget, { siteKey: "0xKEY", action: "register", onToken, loader: () => Promise.resolve(api) }));
    await flush();
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toMatchObject({ sitekey: "0xKEY", action: "register" });

    act(() => rendered[0]?.callback("tok-1"));
    expect(onToken).toHaveBeenLastCalledWith("tok-1");
    act(() => rendered[0]?.["expired-callback"]());
    expect(onToken).toHaveBeenLastCalledWith(null);
    act(() => rendered[0]?.["timeout-callback"]());
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  it("resetKey 递增时重置控件并清空 token；卸载时移除控件", async () => {
    const { api } = fakeApi();
    const onToken = vi.fn();
    const props = { siteKey: "k", action: "login", onToken, loader: () => Promise.resolve(api) } as const;
    mounted = await mount(createElement(TurnstileWidget, { ...props, resetKey: 0 }));
    await flush();
    await mounted.render(createElement(TurnstileWidget, { ...props, resetKey: 1 }));
    expect(api.reset).toHaveBeenCalledWith("widget-1");
    expect(onToken).toHaveBeenLastCalledWith(null);
    await mounted.unmount();
    expect(api.remove).toHaveBeenCalledWith("widget-1");
    mounted = null;
  });

  it("脚本加载失败显示错误与“重试”，重试后重新加载并渲染", async () => {
    const { api, rendered } = fakeApi();
    const loader = vi.fn<() => Promise<TurnstileApi>>().mockRejectedValueOnce(new Error("无法加载 Cloudflare Turnstile 脚本（测试）")).mockResolvedValue(api);
    const onToken = vi.fn();
    mounted = await mount(createElement(TurnstileWidget, { siteKey: "k", action: "pickup", onToken, loader }));
    await flush();
    expect(mounted.container.textContent).toContain("无法加载人机验证组件");
    expect(mounted.container.textContent).toContain("无法加载 Cloudflare Turnstile 脚本（测试）");
    expect(onToken).toHaveBeenLastCalledWith(null);

    const retry = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "重试");
    expect(retry).toBeDefined();
    if (retry) await click(retry);
    await flush();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(rendered).toHaveLength(1);
    expect(mounted.container.textContent).not.toContain("无法加载人机验证组件");
  });

  it("控件报错时显示错误码并清空 token", async () => {
    const { api, rendered } = fakeApi();
    const onToken = vi.fn();
    mounted = await mount(createElement(TurnstileWidget, { siteKey: "k", action: "login", onToken, loader: () => Promise.resolve(api) }));
    await flush();
    act(() => rendered[0]?.["error-callback"]("110200"));
    expect(mounted.container.textContent).toContain("人机验证出错（110200）");
    expect(onToken).toHaveBeenLastCalledWith(null);
  });
});
