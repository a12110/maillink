import { describe, expect, it } from "vitest";
import { applyTheme } from "./apply";
import type { ThemeTarget } from "./apply";
import { applyUrlOverrides, DEFAULT_THEME_SETTINGS, resolveMode } from "./settings";

const LIGHT_VARS: Record<string, string> = { "--color-surface": "#fffdf8", "--color-bg": "#f5f2ea" };

function createFakeTarget(): { target: ThemeTarget; attrs: Map<string, string>; style: Map<string, string> } {
  const attrs = new Map<string, string>();
  const style = new Map<string, string>();
  const target: ThemeTarget = {
    setAttribute: (name, value) => void attrs.set(name, value),
    setStyleProperty: (name, value) => void style.set(name, value),
    removeStyleProperty: (name) => void style.delete(name),
    readVariable: (name) => LIGHT_VARS[name] ?? "",
  };
  return { target, attrs, style };
}

describe("applyTheme", () => {
  it("默认设置：写 data-theme / data-radius，不写任何强调色覆盖", () => {
    const { target, attrs, style } = createFakeTarget();
    applyTheme(target, DEFAULT_THEME_SETTINGS, false);
    expect(attrs.get("data-theme")).toBe("light");
    expect(attrs.get("data-radius")).toBe("4");
    expect(style.size).toBe(0);
  });

  it("自定义强调色写入 accent / fg / text / mix 四个变量；换回默认色后清除", () => {
    const { target, style } = createFakeTarget();
    applyTheme(target, { ...DEFAULT_THEME_SETTINGS, accent: "#2f5fa8" }, false);
    expect([...style.keys()].sort()).toEqual(
      ["--color-accent", "--color-accent-fg", "--color-accent-mix", "--color-accent-text"],
    );
    applyTheme(target, DEFAULT_THEME_SETTINGS, false);
    expect(style.size).toBe(0);
  });

  it("强调色不可达（或格式不合法）时抛错", () => {
    const { target } = createFakeTarget();
    expect(() => applyTheme(target, { ...DEFAULT_THEME_SETTINGS, accent: "blue" }, false)).toThrow();
  });
});

describe("主题设置", () => {
  it("跟随系统按系统偏好解析，显式选择不受系统影响", () => {
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
    expect(resolveMode("light", true)).toBe("light");
    expect(resolveMode("dark", false)).toBe("dark");
  });

  it("URL 覆盖：合法值生效，缺省项沿用基准", () => {
    const next = applyUrlOverrides("?theme=dark&radius=8&accent=%232F5FA8", DEFAULT_THEME_SETTINGS);
    expect(next).toEqual({ mode: "dark", radius: "8", accent: "#2f5fa8" });
    expect(applyUrlOverrides("", DEFAULT_THEME_SETTINGS)).toEqual(DEFAULT_THEME_SETTINGS);
  });

  it("URL 覆盖：非法值抛错而不是静默回退", () => {
    expect(() => applyUrlOverrides("?theme=sepia", DEFAULT_THEME_SETTINGS)).toThrow("theme");
    expect(() => applyUrlOverrides("?radius=5", DEFAULT_THEME_SETTINGS)).toThrow("radius");
    expect(() => applyUrlOverrides("?accent=zzz", DEFAULT_THEME_SETTINGS)).toThrow("accent");
  });
});
