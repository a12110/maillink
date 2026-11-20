import { describe, expect, it } from "vitest";
import tokensCss from "../../styles/tokens.css?raw";
import { contrastRatio } from "../../theme/color";
import { accentBlocker, DEFAULT_ACCENT_TEXT, isHexColor, previewTheme, reportAccent } from "./accent-report";

/** 从 tokens.css 的指定规则块里读 --color-accent-text */
function tokenAccentText(selector: string): string {
  const block = tokensCss.slice(tokensCss.indexOf(`${selector} {`));
  const match = /--color-accent-text:\s*(#[0-9a-f]{6})/i.exec(block);
  if (!match?.[1]) throw new Error(`tokens.css 的 ${selector} 里找不到 --color-accent-text`);
  return match[1];
}

describe("强调色可读性报告（用 shared 的算法）", () => {
  it("默认邮戳红：明暗都达标，浅色下不被调整", () => {
    const [light, dark] = reportAccent("#c8432b");
    expect(light?.ok && light.adjusted).toBe(false);
    expect(dark?.ok).toBe(true);
    expect(light?.ok && light.buttonContrast).toBeGreaterThanOrEqual(4.5);
  });

  it("默认邮戳红：提示的文字色与对比度就是 tokens.css 实际生效的 accent-text，不是推导值；不被说成“对比度不足”", () => {
    expect(DEFAULT_ACCENT_TEXT.light).toBe(tokenAccentText(":root"));
    expect(DEFAULT_ACCENT_TEXT.dark).toBe(tokenAccentText('[data-theme="dark"]'));
    for (const report of reportAccent("#c8432b")) {
      if (!report.ok) throw new Error(`默认色不应推导失败：${report.message}`);
      expect(report.adjusted).toBe(false);
      expect(report.derived.text).toBe(DEFAULT_ACCENT_TEXT[report.mode]);
      expect(report.textContrast).toBeGreaterThanOrEqual(4.5);
    }
    const [light] = reportAccent("#c8432b");
    expect(light?.ok && light.textContrast).toBeCloseTo(contrastRatio("#b53a24", "#f5f2ea"), 5);
  });

  it("非默认色仍按推导值报告", () => {
    const [light] = reportAccent("#2f5fa8");
    expect(light?.ok && light.derived.text).not.toBe(DEFAULT_ACCENT_TEXT.light);
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
