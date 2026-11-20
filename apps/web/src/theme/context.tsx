import { createContext, useContext } from "react";
import type { ThemeController } from "./runtime";

const ThemeControllerContext = createContext<ThemeController | null>(null);

export const ThemeControllerProvider = ThemeControllerContext.Provider;

/** 外观预览用：由 app/bootstrap 提供，测试里提供替身 */
export function useThemeController(): ThemeController {
  const controller = useContext(ThemeControllerContext);
  if (controller === null) throw new Error("缺少 ThemeControllerProvider（应在 app/bootstrap 中提供）");
  return controller;
}
