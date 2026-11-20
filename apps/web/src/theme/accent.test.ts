import { describe, expect, it } from "vitest";
import tokensCss from "../styles/tokens.css?raw";
import {
  AccentUnreachableError,
  deriveAccent,
  ensureContrast,
  MIN_ACCENT_CONTRAST,
  MIN_TEXT_CONTRAST,
  THEME_GROUNDS,
} from "./accent";
import type { Grounds } from "./accent";
import { contrastRatio } from "./color";

// 对比度基准直接从令牌文件读，令牌改了测试跟着变（与 design/scripts/accent-test.mjs 一致）
function readGrounds(selector: string): Grounds {
  // 文件头注释里也出现了选择器文字，所以带上 " {" 定位真正的规则块
  const start = tokensCss.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`tokens.css 里找不到规则块 ${selector}`);
  const block = tokensCss.slice(start);
  const pick = (name: string): string => {
    const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(block);
    if (!match?.[1]) throw new Error(`tokens.css 的 ${selector} 里找不到 --${name}`);
    return match[1];
  };
  return { surface: pick("color-surface"), bg: pick("color-bg") };
}

const GROUNDS = { light: readGrounds(":root"), dark: readGrounds('[data-theme="dark"]') } as const;
const MODES = ["light", "dark"] as const;

/** 11 个预设色：含默认邮戳红、极端的黄 / 白 / 黑 / 品红 / 青 */
const PRESETS = [
  "#c8432b", "#2f5fa8", "#1f7a5a", "#d9a21b", "#3a3632", "#ffff00",
  "#ffffff", "#000000", "#7a7a7a", "#00ffff", "#ff00ff",
];

const RANDOM_SAMPLE_COUNT = 4000;
const LCG_SEED = 42;
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const LCG_MODULUS = 4294967296;
const CHANNEL_COUNT = 3;
const BYTE_RANGE = 256;

function randomHexColors(count: number): string[] {
  let seed = LCG_SEED;
  const next = () => {
    seed = (seed * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
    return seed / LCG_MODULUS;
  };
  return Array.from({ length: count }, () => {
    const channels = Array.from({ length: CHANNEL_COUNT }, () =>
      Math.floor(next() * BYTE_RANGE).toString(16).padStart(2, "0"),
    );
    return `#${channels.join("")}`;
  });
}

/** 返回所有不满足的项；空数组 = 全部达标 */
function violations(hex: string, mode: (typeof MODES)[number]): string[] {
  const { surface, bg } = GROUNDS[mode];
  const d = deriveAccent(hex, { surface, bg }, mode === "dark");
  const checks: Array<[string, number, number]> = [
    ["accent/surface", contrastRatio(d.accent, surface), MIN_ACCENT_CONTRAST],
    ["accent/bg", contrastRatio(d.accent, bg), MIN_ACCENT_CONTRAST],
    ["fg/accent", contrastRatio(d.fg, d.accent), MIN_TEXT_CONTRAST],
    ["fg/hover", contrastRatio(d.fg, d.hover), MIN_TEXT_CONTRAST],
    ["fg/active", contrastRatio(d.fg, d.active), MIN_TEXT_CONTRAST],
    ["text/surface", contrastRatio(d.text, surface), MIN_TEXT_CONTRAST],
    ["text/bg", contrastRatio(d.text, bg), MIN_TEXT_CONTRAST],
  ];
  return checks.filter(([, actual, need]) => actual < need).map(([name, actual]) => `${hex} ${mode} ${name} ${actual.toFixed(2)}`);
}

describe("强调色对比度保证", () => {
  it("shared 里服务端用的明暗底色常量与 tokens.css 一致", () => {
    expect(THEME_GROUNDS).toEqual(GROUNDS);
  });

  it.each(MODES)("11 个预设色在%s模式下 accent / fg / hover / active / text 对 surface 与 bg 全部达标", (mode) => {
    expect(PRESETS.flatMap((hex) => violations(hex, mode))).toEqual([]);
  });

  it.each(MODES)(`随机 ${RANDOM_SAMPLE_COUNT} 个颜色在%s模式下全部达标`, (mode) => {
    const failures = randomHexColors(RANDOM_SAMPLE_COUNT).flatMap((hex) => violations(hex, mode));
    expect(failures).toEqual([]);
  });

  it("前景色只可能是纯白或纯黑，混入色与之相反", () => {
    for (const hex of PRESETS) {
      const d = deriveAccent(hex, GROUNDS.light, false);
      expect(["#ffffff", "#000000"]).toContain(d.fg);
      expect(d.mix).toBe(d.fg === "#ffffff" ? "#000000" : "#ffffff");
    }
  });

  it("默认邮戳红在浅色下不需要被调整", () => {
    expect(deriveAccent("#C8432B", GROUNDS.light, false).accent).toBe("#c8432b");
  });

  it("过浅的强调色在浅色模式下会被压暗，仍达到 3:1", () => {
    const d = deriveAccent("#ffff00", GROUNDS.light, false);
    expect(d.accent).not.toBe("#ffff00");
    expect(contrastRatio(d.accent, GROUNDS.light.surface)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
  });

  it("目标不可达时抛错，不返回未达标的颜色", () => {
    expect(() => ensureContrast("#888888", [GROUNDS.light.surface], 25, "#1f1d1a", "accent")).toThrow(
      AccentUnreachableError,
    );
  });

  it("拒绝不是 #rrggbb 的输入", () => {
    expect(() => deriveAccent("red", GROUNDS.light, false)).toThrow("#rrggbb");
    expect(() => deriveAccent("#fff", GROUNDS.light, false)).toThrow("#rrggbb");
  });
});
