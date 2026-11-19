import { DEFAULT_ACCENT, deriveAccent } from "./accent";
import { resolveMode } from "./settings";
import type { ThemeSettings } from "./settings";

/** 对 <html> 的最小抽象，便于在无 DOM 环境下单测 */
export type ThemeTarget = {
  setAttribute(name: string, value: string): void;
  setStyleProperty(name: string, value: string): void;
  removeStyleProperty(name: string): void;
  /** 读取当前生效的 CSS 变量（用于取 surface / bg 作对比度基准） */
  readVariable(name: string): string;
};

const ACCENT_VARIABLES = ["--color-accent", "--color-accent-fg", "--color-accent-text", "--color-accent-mix"] as const;

function clearAccent(target: ThemeTarget): void {
  for (const name of ACCENT_VARIABLES) target.removeStyleProperty(name);
}

function applyAccent(target: ThemeTarget, hex: string, dark: boolean): void {
  clearAccent(target);
  if (hex.toLowerCase() === DEFAULT_ACCENT) return;
  const derived = deriveAccent(
    hex,
    { surface: target.readVariable("--color-surface"), bg: target.readVariable("--color-bg") },
    dark,
  );
  target.setStyleProperty("--color-accent", derived.accent);
  target.setStyleProperty("--color-accent-fg", derived.fg);
  target.setStyleProperty("--color-accent-text", derived.text);
  target.setStyleProperty("--color-accent-mix", derived.mix);
}

/**
 * 把主题设置写到 <html>：data-theme / data-radius 与强调色覆盖。
 * 先写 data-theme，再按新模式的 surface / bg 计算强调色；强调色目标不可达时抛错（调用方负责呈现）。
 */
export function applyTheme(target: ThemeTarget, settings: ThemeSettings, prefersDark: boolean): void {
  const mode = resolveMode(settings.mode, prefersDark);
  target.setAttribute("data-theme", mode);
  target.setAttribute("data-radius", settings.radius);
  applyAccent(target, settings.accent, mode === "dark");
}

export function createDomThemeTarget(root: HTMLElement): ThemeTarget {
  return {
    setAttribute: (name, value) => root.setAttribute(name, value),
    setStyleProperty: (name, value) => root.style.setProperty(name, value),
    removeStyleProperty: (name) => root.style.removeProperty(name),
    readVariable: (name) => getComputedStyle(root).getPropertyValue(name).trim(),
  };
}
