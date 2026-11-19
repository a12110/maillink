import { applyTheme, createDomThemeTarget } from "./apply";
import type { ThemeTarget } from "./apply";
import { applyUrlOverrides, DEFAULT_THEME_SETTINGS } from "./settings";
import type { ThemeSettings } from "./settings";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** 对 matchMedia 结果的最小抽象，便于测试 */
export type DarkModeSource = {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
};

export type ThemeRuntimeDeps = {
  target: ThemeTarget;
  media: DarkModeSource;
  search: string;
  /** 任何阶段的失败都交给它呈现，不静默 */
  report: (error: unknown) => void;
};

/**
 * 启动主题：不会抛错。URL 参数不合法或强调色应用失败时，把错误交给 report，并按默认设置继续；
 * “跟随系统”时监听系统明暗变化，监听器里的失败同样走 report。
 * 本里程碑的主题来源是本地默认值 + URL 预览覆盖；TODO(M6): 改读 /api/public/config 的外观字段。
 */
export function startThemeWith(deps: ThemeRuntimeDeps): { update: (settings: ThemeSettings) => void } {
  const { target, media, search, report } = deps;
  let current = DEFAULT_THEME_SETTINGS;
  try {
    current = applyUrlOverrides(search, DEFAULT_THEME_SETTINGS);
  } catch (error) {
    report(error);
  }

  const render = () => {
    try {
      applyTheme(target, current, media.matches);
    } catch (error) {
      report(error);
    }
  };
  render();
  media.addEventListener("change", render);

  return {
    update(settings) {
      current = settings;
      render();
    },
  };
}

export function startTheme(report: (error: unknown) => void): { update: (settings: ThemeSettings) => void } {
  return startThemeWith({
    target: createDomThemeTarget(document.documentElement),
    media: window.matchMedia(DARK_QUERY),
    search: window.location.search,
    report,
  });
}
