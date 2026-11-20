import { SHARE_LINK_TEMPLATE_VARIABLES } from "@maillink/shared";
import { ApiError } from "../errors";
import { HTTP_BAD_REQUEST } from "../http-status";

// 链接导出（06 §8）：CSV（address,note,link）或按行模板（如 `{address}----{link}`）。
// CSV 注入防护：任何以 = + - @ 或制表符、回车开头的值前面加一个单引号，表格软件不会把它当公式。
// 模板模式同样处理每个代入值，并把值里的换行换成空格（一行一个链接，不能被值撑成多行）。

export type ExportRow = Record<(typeof SHARE_LINK_TEMPLATE_VARIABLES)[number], string>;

const FORMULA_START = /^[=+\-@\t\r]/u;
const CSV_NEEDS_QUOTES = /[",\r\n]/u;
const LINE_BREAKS = /[\r\n]+/gu;
const VARIABLE = /\{([^{}]*)\}/gu;
const CSV_HEADER = ["address", "note", "link"] as const;
const ALLOWED = new Set<string>(SHARE_LINK_TEMPLATE_VARIABLES);

export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
  const safe = neutralizeFormula(value);
  return CSV_NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(rows: readonly ExportRow[]): string {
  const lines = [CSV_HEADER.join(","), ...rows.map((row) => CSV_HEADER.map((key) => csvCell(row[key])).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}

/** 模板只能用白名单里的变量，且必须是单行；不合规 400 template_invalid */
export function validateTemplate(template: string): void {
  if (/[\r\n]/u.test(template)) {
    throw new ApiError(HTTP_BAD_REQUEST, "template_invalid", "行模板不能包含换行");
  }
  const unknown = [...template.matchAll(VARIABLE)].map((match) => match[1] ?? "").filter((name) => !ALLOWED.has(name));
  if (unknown.length > 0) {
    throw new ApiError(
      HTTP_BAD_REQUEST,
      "template_invalid",
      `行模板含不支持的变量：${unknown.map((name) => `{${name}}`).join(" ")}；可用 ${SHARE_LINK_TEMPLATE_VARIABLES.map((name) => `{${name}}`).join(" ")}`,
    );
  }
}

export function renderTemplate(template: string, rows: readonly ExportRow[]): string {
  validateTemplate(template);
  const lines = rows.map((row) =>
    template.replace(VARIABLE, (_match, name: string) => neutralizeFormula(row[name as keyof ExportRow].replace(LINE_BREAKS, " "))),
  );
  return `${lines.join("\n")}\n`;
}
