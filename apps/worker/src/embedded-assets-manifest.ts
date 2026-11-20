// 单文件 worker.js 内嵌的前端清单，由 scripts/build-single-worker.ts 生成，src/embedded-assets.ts 读取。
// 只放类型，构建脚本（Node）与 Worker 共用。

/** 一个前端文件；文本按原样存，其余按 base64 存 */
export type EmbeddedAsset = {
  contentType: string;
  encoding: "utf8" | "base64";
  body: string;
};

/** 来自构建生成的 _headers：pattern 只支持 "/*"、"/前缀/*" 与精确路径 */
export type EmbeddedHeaderRule = {
  pattern: string;
  headers: Array<[name: string, value: string]>;
};

export type EmbeddedAssetManifest = {
  /** 键是请求路径，例如 "/index.html"、"/assets/index-abc.js" */
  files: Record<string, EmbeddedAsset>;
  headerRules: EmbeddedHeaderRule[];
  /** 找不到文件时回退的页面（SPA），对应 not_found_handling: single-page-application */
  spaFallback: string;
};
