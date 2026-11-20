// WCAG 对比度与 sRGB 混色：实现在 @maillink/shared 的 theme-contrast（前后端共用，服务端保存强调色前也用它校验），这里只转出。
export { assertHex, contrastRatio, hexToRgb, mixColors, relativeLuminance, rgbToHex } from "@maillink/shared";
export type { Rgb } from "@maillink/shared";
