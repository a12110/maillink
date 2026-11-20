import { SHARE_LINK_LIMITS, SHARE_LINK_TEMPLATE_VARIABLES } from "@maillink/shared";
import type { ShareLinkExport } from "@maillink/shared";

// 链接导出：CSV 或按行模板。规则与后端 links/export.ts 的 validateTemplate 一致（后端仍会校验，这里只是提前给出原因）。

export const DEFAULT_TEMPLATE = "{address}----{link}";
export type ExportFormat = "csv" | "template";

const VARIABLE = /\{([^{}]*)\}/gu;
const ALLOWED: ReadonlySet<string> = new Set(SHARE_LINK_TEMPLATE_VARIABLES);

export const TEMPLATE_VARIABLE_HINT = SHARE_LINK_TEMPLATE_VARIABLES.map((name) => `{${name}}`).join(" ");

/** 返回错误原因；null = 合法 */
export function validateTemplate(template: string): string | null {
  if (template.trim() === "") return "请填写行模板，如 {address}----{link}";
  if (/[\r\n]/u.test(template)) return "行模板不能包含换行";
  if (template.length > SHARE_LINK_LIMITS.templateMaxLength) return `行模板最长 ${SHARE_LINK_LIMITS.templateMaxLength} 个字符`;
  const unknown = [...template.matchAll(VARIABLE)].map((match) => match[1] ?? "").filter((name) => !ALLOWED.has(name));
  if (unknown.length > 0) return `行模板含不支持的变量：${unknown.map((name) => `{${name}}`).join(" ")}；可用 ${TEMPLATE_VARIABLE_HINT}`;
  if (!template.includes("{link}")) return "行模板里没有 {link}，导出的内容将不含链接";
  return null;
}

export function buildExportRequest(ids: number[], format: ExportFormat, template: string): ShareLinkExport {
  return format === "csv" ? { ids, format: "csv" } : { ids, format: "template", template };
}

export function exportFilename(format: ExportFormat, now: Date): string {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `取件链接-${stamp}.${format === "csv" ? "csv" : "txt"}`;
}
