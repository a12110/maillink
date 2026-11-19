import { assertHex } from "./color";
import { DEFAULT_ACCENT } from "./accent";

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const RADIUS_LEVELS = ["0", "4", "8"] as const;
export type RadiusLevel = (typeof RADIUS_LEVELS)[number];

export type ThemeSettings = {
  mode: ThemeMode;
  radius: RadiusLevel;
  /** #rrggbb；等于 DEFAULT_ACCENT 时不写覆盖，直接用 tokens.css 的取值 */
  accent: string;
};

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  mode: "system",
  radius: "4",
  accent: DEFAULT_ACCENT,
};

export type ResolvedMode = "light" | "dark";

/** “跟随系统”在这里解析成 light / dark，CSS 里不重复一份 media query */
export function resolveMode(mode: ThemeMode, prefersDark: boolean): ResolvedMode {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

/** URL 预览参数不合法：带上参数名、收到的值与可选值，供界面原样呈现 */
export class ThemeParamError extends Error {
  constructor(
    readonly param: string,
    readonly received: string,
    readonly expected: string,
  ) {
    super(`主题参数 ${param} 不合法："${received}"，可选 ${expected}`);
    this.name = "ThemeParamError";
  }
}

const ACCENT_FORMAT = "#rrggbb（URL 里写成 %23rrggbb）";

function pickOption<T extends string>(raw: string, options: readonly T[], name: string): T {
  const match = options.find((option) => option === raw);
  if (match === undefined) throw new ThemeParamError(name, raw, options.join(" / "));
  return match;
}

function pickAccent(raw: string): string {
  try {
    return assertHex(raw);
  } catch {
    throw new ThemeParamError("accent", raw, ACCENT_FORMAT);
  }
}

/**
 * 本地覆盖：URL 的 ?theme=dark&radius=8&accent=%232f5fa8，用于预览与截图，不持久化。
 * TODO(M6): 系统设置接口（/api/public/config 的外观字段）接入后，base 改为服务端值，这里只保留预览用途。
 * 参数不合法直接抛错，不静默回退。
 */
export function applyUrlOverrides(search: string, base: ThemeSettings): ThemeSettings {
  const query = new URLSearchParams(search);
  const mode = query.get("theme");
  const radius = query.get("radius");
  const accent = query.get("accent");
  return {
    mode: mode === null ? base.mode : pickOption(mode, THEME_MODES, "theme"),
    radius: radius === null ? base.radius : pickOption(radius, RADIUS_LEVELS, "radius"),
    accent: accent === null ? base.accent : pickAccent(accent),
  };
}
