import type { AppearanceSettings } from "@maillink/shared";
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

export type ThemeOverrides = Partial<ThemeSettings>;

/**
 * URL 预览参数：?theme=dark&radius=8&accent=%232f5fa8，只用于预览与截图，不持久化。
 * 参数不合法直接抛错，不静默回退。
 */
export function parseUrlOverrides(search: string): ThemeOverrides {
  const query = new URLSearchParams(search);
  const mode = query.get("theme");
  const radius = query.get("radius");
  const accent = query.get("accent");
  return {
    ...(mode === null ? {} : { mode: pickOption(mode, THEME_MODES, "theme") }),
    ...(radius === null ? {} : { radius: pickOption(radius, RADIUS_LEVELS, "radius") }),
    ...(accent === null ? {} : { accent: pickAccent(accent) }),
  };
}

/** 服务端设置（公开配置的 appearance）作底，URL 预览参数覆盖其上 */
export function applyUrlOverrides(search: string, base: ThemeSettings): ThemeSettings {
  return { ...base, ...parseUrlOverrides(search) };
}

/** 公开配置 / 外观设置组 → 前端主题设置（preset 目前只有 default，不影响变量值） */
export function themeFromAppearance(appearance: AppearanceSettings): ThemeSettings {
  return { mode: appearance.mode, radius: appearance.radius, accent: appearance.accent };
}
