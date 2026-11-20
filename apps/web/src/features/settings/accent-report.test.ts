import { describe, expect, it } from "vitest";
import { accentBlocker, isHexColor, previewTheme, reportAccent } from "./accent-report";

describe("强调色可读性报告（用 shared 的算法）", () => {
  it("默认邮戳红：明暗都达标，浅色下不被调整", () => {
    const [light, dark] = reportAccent("#c8432b");
    expect(light?.ok && light.adjusted).toBe(false);
    expect(dark?.ok).toBe(true);
    expect(light?.ok && light.buttonContrast).toBeGreaterThanOrEqual(4.5);
  });

  it("过浅的黄色在浅色主题下被自动调整，并告知", () => {
    const [light] = reportAccent("#ffff00");
    expect(light?.ok && light.adjusted).toBe(true);
    expect(light?.ok && light.derived.accent).not.toBe("#ffff00");
  });

  it("格式不对时不推导，也不拦保存（由 schema 报格式错误）", () => {
    expect(isHexColor("#12")).toBe(false);
    expect(accentBlocker("#12")).toBeNull();
    expect(accentBlocker("#ffff00")).toBeNull();
  });

  it("预览主题：强调色不合法时沿用已保存的强调色", () => {
    const draft = { mode: "dark", radius: "8", accent: "#12" } as const;
    expect(previewTheme(draft, "#2f5fa8")).toEqual({ mode: "dark", radius: "8", accent: "#2f5fa8" });
    expect(previewTheme({ ...draft, accent: "#1f7a5a" }, "#2f5fa8").accent).toBe("#1f7a5a");
  });
});
