// WCAG 对比度与 sRGB 混色。强调色保证算法（accent.ts）的底层，纯函数，无 DOM 依赖。

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
