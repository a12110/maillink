import type { THEME_PRESETS } from "@maillink/shared";
import { AccentUnreachableError, deriveAccent, THEME_GROUNDS, WHITE } from "../../theme/accent";
import type { AccentDerivation } from "../../theme/accent";
import type { ThemeSettings } from "../../theme";
import { assertHex, contrastRatio } from "../../theme/color";

/** 设置页上推荐的强调色（DESIGN.md 预设色里的前几个；只是快捷选项，任何 #rrggbb 都可以） */
export const ACCENT_SWATCHES: ReadonlyArray<{ hex: string; label: string }> = [
  { hex: "#c8432b", label: "邮戳红（默认）" },
  { hex: "#2f5fa8", label: "靛蓝" },
  { hex: "#1f7a5a", label: "松绿" },
  { hex: "#d9a21b", label: "琥珀" },
  { hex: "#3a3632", label: "墨色" },
];

export const PRESET_LABELS: Record<(typeof THEME_PRESETS)[number], string> = { default: "默认" };

export type ModeReport =
  | {
      mode: "light" | "dark";
      ok: true;
      derived: AccentDerivation;
      /** 强调色被压暗 / 提亮过（原色对底色对比度不足 3:1） */
      adjusted: boolean;
      /** 按钮上前景色（白或黑）对强调色的对比度 */
      buttonContrast: number;
      /** 强调色作文字时对 surface 与 bg 的较小对比度 */
      textContrast: number;
      foreground: "白色" | "黑色";
    }
  | { mode: "light" | "dark"; ok: false; message: string };

const MODES = ["light", "dark"] as const;

function reportMode(hex: string, mode: (typeof MODES)[number]): ModeReport {
  const grounds = THEME_GROUNDS[mode];
  try {
    const derived = deriveAccent(hex, grounds, mode === "dark");
    return {
      mode,
      ok: true,
      derived,
      adjusted: derived.accent !== hex,
      buttonContrast: contrastRatio(derived.fg, derived.accent),
      textContrast: Math.min(contrastRatio(derived.text, grounds.surface), contrastRatio(derived.text, grounds.bg)),
      foreground: derived.fg === WHITE ? "白色" : "黑色",
    };
  } catch (error) {
    if (error instanceof AccentUnreachableError) return { mode, ok: false, message: error.message };
    throw error;
  }
}

/** 是不是合法的 #rrggbb（不合法时设置页只提示格式，不做对比度推导） */
export function isHexColor(value: string): boolean {
  try {
    assertHex(value);
    return true;
  } catch {
    return false;
  }
}

/** 明暗两套主题下的推导结果；hex 必须是合法 #rrggbb */
export function reportAccent(hex: string): ModeReport[] {
  const normalized = assertHex(hex);
  return MODES.map((mode) => reportMode(normalized, mode));
}

/** 保存会被拒的原因（任一套主题推导不出达标颜色）；格式不对或都可达返回 null */
export function accentBlocker(hex: string): string | null {
  if (!isHexColor(hex)) return null;
  const failures = reportAccent(hex).filter((report) => !report.ok);
  if (failures.length === 0) return null;
  return failures.map((report) => `${report.mode === "light" ? "浅色" : "深色"}主题：${report.ok ? "" : report.message}`).join("；");
}

/** 预览用的主题：强调色不合法或推导不出时沿用已保存的强调色，避免把错误扔进全局主题提示 */
export function previewTheme(draft: ThemeSettings, savedAccent: string): ThemeSettings {
  const usable = isHexColor(draft.accent) && accentBlocker(draft.accent) === null;
  return { mode: draft.mode, radius: draft.radius, accent: usable ? draft.accent : savedAccent };
}
