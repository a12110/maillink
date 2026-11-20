// 强调色对比度保证（DESIGN.md「主题覆盖与强调色」）：算法在 @maillink/shared 的 theme-contrast，
// 服务端保存前与这里的运行时应用用同一份实现，所以后端接受的颜色前端一定能推导出来。
export {
  AccentUnreachableError,
  BLACK,
  DEFAULT_ACCENT,
  deriveAccent,
  ensureContrast,
  INK,
  MIN_ACCENT_CONTRAST,
  MIN_TEXT_CONTRAST,
  THEME_GROUNDS,
  WHITE,
} from "@maillink/shared";
export type { AccentDerivation, Grounds } from "@maillink/shared";
