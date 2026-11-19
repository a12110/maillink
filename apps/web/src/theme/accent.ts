// 强调色对比度保证（DESIGN.md「主题覆盖与强调色」；移植自 design/prototypes/theme.js）。
//   1. accent：对 surface 和 bg 的对比度都 ≥ 3:1；不足时向墨色（浅色）/ 白色（深色）按 4% 步长混合
//   2. accent-fg：在 #fff 与 #000 里取对比度更高者（任何底色最差 4.58:1）
//   3. accent-mix / hover / active：fg 为白 → 混入黑，fg 为黑 → 混入白；hover 混 12%、active 混 22%，逐项断言 fg ≥ 4.5:1
//   4. accent-text：对 surface 和 bg 都 ≥ 4.5:1，同样向墨色 / 白色混合
// 任一步混到纯墨 / 纯白仍不达标就抛错，绝不返回未达标的颜色。
import { assertHex, contrastRatio, mixColors } from "./color";

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
