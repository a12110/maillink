import { applyTheme, createDomThemeTarget } from "./apply";
import type { ThemeTarget } from "./apply";
import { DEFAULT_THEME_SETTINGS, parseUrlOverrides } from "./settings";
import type { ThemeOverrides, ThemeSettings } from "./settings";

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

export type ThemeController = {
  /** 服务端设置（/api/public/config 的 appearance）到达或变化；URL 预览参数仍盖在它上面 */
  update: (settings: ThemeSettings) => void;
  /** 实时预览：传设置即时作用于当前页面，传 null 撤销并回到服务端设置；不持久化 */
  preview: (settings: ThemeSettings | null) => void;
};

/**
 * 启动主题：不会抛错。生效值 = 预览值 ?? (服务端设置 + URL 预览参数)。服务端设置到达前用默认值；
 * index.html 的内联脚本已按系统明暗先设了 data-theme，这里首次渲染（mode=system）与它一致，不会闪。
 * URL 参数不合法或强调色应用失败时，把错误交给 report 并继续；“跟随系统”时监听系统明暗变化，监听器里的失败同样走 report。
 */
export function startThemeWith(deps: ThemeRuntimeDeps): ThemeController {
  const { target, media, search, report } = deps;
  let server = DEFAULT_THEME_SETTINGS;
  let previewing: ThemeSettings | null = null;
  let overrides: ThemeOverrides = {};
  try {
    overrides = parseUrlOverrides(search);
  } catch (error) {
    report(error);
  }

  const render = () => {
    try {
      applyTheme(target, previewing ?? { ...server, ...overrides }, media.matches);
    } catch (error) {
      report(error);
    }
  };
  render();
  media.addEventListener("change", render);

  return {
    update(settings) {
      server = settings;
      render();
    },
    preview(settings) {
      previewing = settings;
      render();
    },
  };
}

export function startTheme(report: (error: unknown) => void): ThemeController {
  return startThemeWith({
    target: createDomThemeTarget(document.documentElement),
    media: window.matchMedia(DARK_QUERY),
    search: window.location.search,
    report,
  });
}
