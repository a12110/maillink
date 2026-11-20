// 强调色对比度保证（DESIGN.md「主题覆盖与强调色」）。纯函数，无 DOM 依赖，前后端共用。
// 由 apps/web/src/theme/color.ts 与 accent.ts 原样复制而来；前端之后改为从这里导入，并删除那两份重复实现。
//   1. accent：对 surface 和 bg 的对比度都 ≥ 3:1；不足时向墨色（浅色）/ 白色（深色）按 4% 步长混合
//   2. accent-fg：在 #fff 与 #000 里取对比度更高者（任何底色最差 4.58:1）
//   3. accent-mix / hover / active：fg 为白 → 混入黑，fg 为黑 → 混入白；hover 混 12%、active 混 22%，逐项断言 fg ≥ 4.5:1
//   4. accent-text：对 surface 和 bg 都 ≥ 4.5:1，同样向墨色 / 白色混合
// 任一步混到纯墨 / 纯白仍不达标就抛错，绝不返回未达标的颜色。

export type Rgb = readonly [number, number, number];

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;
const HEX_RADIX = 16;
const BYTE_MAX = 255;
const BITS_PER_BYTE = 8;
const HEX_DIGITS_PER_CHANNEL = 2;

// WCAG 2.x 相对亮度
const SRGB_LINEAR_CUTOFF = 0.03928;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_GAMMA_OFFSET = 0.055;
const SRGB_GAMMA_DIVISOR = 1.055;
const SRGB_GAMMA_EXPONENT = 2.4;
const LUMA_RED = 0.2126;
const LUMA_GREEN = 0.7152;
const LUMA_BLUE = 0.0722;
const CONTRAST_FLARE = 0.05;

/** 只接受 #rrggbb；返回小写。不合法直接抛错，不猜测意图 */
export function assertHex(value: string): string {
  if (!HEX_PATTERN.test(value)) throw new Error(`颜色必须是 #rrggbb 格式，收到 "${value}"`);
  return value.toLowerCase();
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(assertHex(hex).slice(1), HEX_RADIX);
  return [n >> (BITS_PER_BYTE * 2), (n >> BITS_PER_BYTE) & BYTE_MAX, n & BYTE_MAX];
}

export function rgbToHex(rgb: Rgb): string {
  const channels = rgb.map((v) => Math.round(v).toString(HEX_RADIX).padStart(HEX_DIGITS_PER_CHANNEL, "0"));
  return `#${channels.join("")}`;
}

function linearize(channel: number): number {
  const v = channel / BYTE_MAX;
  return v <= SRGB_LINEAR_CUTOFF
    ? v / SRGB_LINEAR_DIVISOR
    : Math.pow((v + SRGB_GAMMA_OFFSET) / SRGB_GAMMA_DIVISOR, SRGB_GAMMA_EXPONENT);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return LUMA_RED * linearize(r) + LUMA_GREEN * linearize(g) + LUMA_BLUE * linearize(b);
}

export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + CONTRAST_FLARE) / (Math.min(x, y) + CONTRAST_FLARE);
}

/** 在 sRGB 空间里从 a 向 b 混合 t（0..1），与 CSS `color-mix(in srgb, …)` 同一空间 */
export function mixColors(a: string, b: string, t: number): string {
  const p = hexToRgb(a);
  const q = hexToRgb(b);
  return rgbToHex([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
}

export const INK = "#1f1d1a";
export const WHITE = "#ffffff";
export const BLACK = "#000000";
export const DEFAULT_ACCENT = "#c8432b";

const MIX_STEPS = 25;
const HOVER_MIX = 0.12;
const ACTIVE_MIX = 0.22;

export const MIN_ACCENT_CONTRAST = 3;
export const MIN_TEXT_CONTRAST = 4.5;

export type Grounds = { readonly surface: string; readonly bg: string };

/** 明暗两套主题的底色，取自 apps/web/src/styles/tokens.css（:root 与 [data-theme="dark"]）；改 tokens 时同步 */
export const THEME_GROUNDS = {
  light: { surface: "#fffdf8", bg: "#f5f2ea" },
  dark: { surface: "#1f1d19", bg: "#171512" },
} as const satisfies Record<"light" | "dark", Grounds>;

export type AccentDerivation = {
  accent: string;
  fg: string;
  /** hover / active 的混入色，写入 --color-accent-mix，CSS 用 color-mix 得到 hover / active */
  mix: string;
  hover: string;
  active: string;
  text: string;
};

export class AccentUnreachableError extends Error {
  constructor(label: string, grounds: readonly string[], target: number) {
    super(`无法把 ${label} 调到对 ${grounds.join("、")} 的对比度 ≥ ${target}:1`);
    this.name = "AccentUnreachableError";
  }
}

function meetsTarget(color: string, grounds: readonly string[], target: number): boolean {
  return grounds.every((ground) => contrastRatio(color, ground) >= target);
}

/** 从 color 逐步向 toward 混合，返回第一个对所有底色都达标的值；到头仍不行则抛错 */
export function ensureContrast(
  color: string,
  grounds: readonly string[],
  target: number,
  toward: string,
  label: string,
): string {
  for (let step = 0; step <= MIX_STEPS; step++) {
    const candidate = mixColors(color, toward, step / MIX_STEPS);
    if (meetsTarget(candidate, grounds, target)) return candidate;
  }
  throw new AccentUnreachableError(label, grounds, target);
}

function pickForeground(accent: string): string {
  return contrastRatio(accent, WHITE) >= contrastRatio(accent, BLACK) ? WHITE : BLACK;
}

export function deriveAccent(hex: string, grounds: Grounds, dark: boolean): AccentDerivation {
  const toward = dark ? WHITE : INK;
  const groundList = [assertHex(grounds.surface), assertHex(grounds.bg)];
  const accent = ensureContrast(assertHex(hex), groundList, MIN_ACCENT_CONTRAST, toward, "强调色");
  const fg = pickForeground(accent);
  const mix = fg === WHITE ? BLACK : WHITE;
  const hover = mixColors(accent, mix, HOVER_MIX);
  const active = mixColors(accent, mix, ACTIVE_MIX);
  for (const background of [accent, hover, active]) {
    if (contrastRatio(fg, background) < MIN_TEXT_CONTRAST) {
      throw new AccentUnreachableError(`强调色 ${background} 上的前景 ${fg}`, [background], MIN_TEXT_CONTRAST);
    }
  }
  const text = ensureContrast(accent, groundList, MIN_TEXT_CONTRAST, toward, "强调色文字");
  return { accent, fg, mix, hover, active, text };
}

/**
 * 服务端保存强调色前的检查：明暗两套底色都必须能推导出达标的按钮与文字颜色。
 * 目标不可达抛 AccentUnreachableError（调用方转成 400 accent_unreachable）。
 */
export function assertAccentReachable(
  hex: string,
  grounds: { readonly light: Grounds; readonly dark: Grounds } = THEME_GROUNDS,
): void {
  deriveAccent(hex, grounds.light, false);
  deriveAccent(hex, grounds.dark, true);
}
