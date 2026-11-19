import { describe, expect, it } from "vitest";
import type { ThemeTarget } from "./apply";
import { createThemeIssueStore, toThemeIssue } from "./issues";
import { startThemeWith } from "./runtime";
import type { DarkModeSource } from "./runtime";
import { applyUrlOverrides, DEFAULT_THEME_SETTINGS, ThemeParamError } from "./settings";

function fakeTarget(variables: Record<string, string>) {
  const attrs = new Map<string, string>();
  const target: ThemeTarget = {
    setAttribute: (name, value) => void attrs.set(name, value),
    setStyleProperty: () => undefined,
    removeStyleProperty: () => undefined,
    readVariable: (name) => variables[name] ?? "",
  };
  return { target, attrs };
}

function fakeMedia(initial: boolean) {
  const listeners: Array<() => void> = [];
  const media: DarkModeSource & { matches: boolean } = {
    matches: initial,
    addEventListener: (_type, listener) => void listeners.push(listener),
  };
  return { media, fire: (matches: boolean) => { media.matches = matches; listeners.forEach((l) => l()); } };
}

const LIGHT_VARS = { "--color-surface": "#fffdf8", "--color-bg": "#f5f2ea" };

describe("startThemeWith：错误不再让页面白屏，也不静默", () => {
  it("非法 theme 参数：不抛错，报告参数名 / 收到的值 / 可选值，并按默认主题继续", () => {
    const { target, attrs } = fakeTarget(LIGHT_VARS);
    const store = createThemeIssueStore();
    expect(() =>
      startThemeWith({ target, media: fakeMedia(false).media, search: "?theme=sepia", report: store.report }),
    ).not.toThrow();
    const [issue] = store.getSnapshot();
    expect(issue?.title).toContain("theme");
    expect(issue?.message).toContain("sepia");
    expect(issue?.message).toContain("light / dark / system");
    expect(attrs.get("data-theme")).toBe("light");
  });

  it("非法 accent / radius 同样报告", () => {
    for (const search of ["?accent=blue", "?radius=5"]) {
      const store = createThemeIssueStore();
      startThemeWith({ target: fakeTarget(LIGHT_VARS).target, media: fakeMedia(false).media, search, report: store.report });
      expect(store.getSnapshot()).toHaveLength(1);
    }
  });

  it("合法参数：没有任何报告", () => {
    const store = createThemeIssueStore();
    startThemeWith({ target: fakeTarget(LIGHT_VARS).target, media: fakeMedia(false).media, search: "?theme=dark&accent=%232f5fa8", report: store.report });
    expect(store.getSnapshot()).toEqual([]);
  });

  it("系统明暗切换监听器里的失败也被报告，而不是变成未捕获异常", () => {
    // 深色时读不到 surface / bg（模拟变量缺失），强调色派生会抛错
    const variables: Record<string, string> = { ...LIGHT_VARS };
    const { target } = fakeTarget(variables);
    const failing: ThemeTarget = { ...target, readVariable: (name) => (media.media.matches ? "" : (variables[name] ?? "")) };
    const media = fakeMedia(false);
    const store = createThemeIssueStore();
    startThemeWith({ target: failing, media: media.media, search: "?accent=%232f5fa8", report: store.report });
    expect(store.getSnapshot()).toEqual([]);
    expect(() => media.fire(true)).not.toThrow();
    expect(store.getSnapshot()).toHaveLength(1);
  });
});

describe("问题归类", () => {
  it("ThemeParamError 带参数名与可选值", () => {
    expect(toThemeIssue(new ThemeParamError("radius", "5", "0 / 4 / 8"))).toEqual({
      title: "主题参数 radius 不合法",
      message: '收到 "5"，可选 0 / 4 / 8。页面已按默认主题显示。',
    });
  });

  it("accent 格式错误抛 ThemeParamError", () => {
    expect(() => applyUrlOverrides("?accent=zzz", DEFAULT_THEME_SETTINGS)).toThrow(ThemeParamError);
  });
});
