import { MAILBOX_LIMITS, mailboxTagSchema, type MailboxImportItem } from "@maillink/shared";
import { ApiError } from "../errors";
import { HTTP_BAD_REQUEST } from "../http-status";
import { lowerDomain } from "../mail-source";

// 收件地址导入的解析（纯函数）：每行 `地址[,平台[,备注]]`（06 §8），平台列映射成标签（可多个），逗号或制表符分隔，支持 CSV 双引号。
// 地址规范化：去掉所有空白（含零宽字符）、域名小写（与 temp_email 写库规则一致）；address_lc 全小写，用于去重。

type Reason = NonNullable<MailboxImportItem["reason"]>;

export type ImportLine = {
  line: number;
  input: string;
  address: string | null;
  address_lc: string | null;
  note: string | null;
  tags: string[];
  /** 格式类问题；重复判定在调用方（需要查库） */
  error: Reason | null;
};

const HEADER_CELLS: ReadonlySet<string> = new Set(["address", "email", "mailbox", "地址", "邮箱", "收件地址"]);
const WHITESPACE = /[\s\u200b-\u200d\u2060\ufeff]+/gu;
const TAG_SEPARATORS = /[\s;|]+/u;
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/u;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const DOMAIN_MAX_LENGTH = 253;

/** 一行拆成单元格：逗号或制表符分隔；以双引号开头的单元格按 CSV 规则读到闭合引号（"" 表示一个引号） */
export function splitImportLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? "";
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === "," || ch === "\t") {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

function isValidDomainPart(domain: string): boolean {
  if (domain.length === 0 || domain.length > DOMAIN_MAX_LENGTH) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => DOMAIN_LABEL.test(label)) && /^[a-z]/u.test(labels.at(-1) ?? "");
}

/** 规范化并校验一个地址；无效时返回原因 */
export function normalizeMailboxAddress(input: string): { address: string; address_lc: string } | { error: Reason } {
  const compact = input.replace(WHITESPACE, "");
  if (compact.length > MAILBOX_LIMITS.addressMaxLength) return { error: "too_long" };
  const at = compact.lastIndexOf("@");
  if (at <= 0) return { error: "invalid_format" };
  const address = lowerDomain(compact);
  const local = address.slice(0, at);
  if (local.length > MAILBOX_LIMITS.localPartMaxLength) return { error: "too_long" };
  if (!LOCAL_PART.test(local) || !isValidDomainPart(address.slice(at + 1))) return { error: "invalid_format" };
  return { address, address_lc: address.toLowerCase() };
}

function parseTags(cell: string | undefined, extra: readonly string[]): { tags: string[] } | { error: Reason } {
  const raw = (cell ?? "").split(TAG_SEPARATORS).filter((tag) => tag.length > 0);
  for (const tag of raw) {
    if (!mailboxTagSchema.safeParse(tag).success) return { error: "invalid_tag" };
  }
  const tags = [...new Set([...raw, ...extra])];
  return tags.length > MAILBOX_LIMITS.tagsPerMailbox ? { error: "too_many_tags" } : { tags };
}

function parseLine(lineNo: number, cells: string[], extraTags: readonly string[]): ImportLine {
  const [input = "", tagCell, noteCell = ""] = cells;
  const base = { line: lineNo, input, address: null, address_lc: null, note: null, tags: [] };
  const normalized = normalizeMailboxAddress(input);
  if ("error" in normalized) return { ...base, error: normalized.error };
  const withAddress = { ...base, ...normalized };
  if (noteCell.length > MAILBOX_LIMITS.noteMaxLength) return { ...withAddress, error: "note_too_long" };
  const tags = parseTags(tagCell, extraTags);
  if ("error" in tags) return { ...withAddress, error: tags.error };
  return { ...withAddress, note: noteCell === "" ? null : noteCell, tags: tags.tags, error: null };
}

/** 解析整段导入文本；空行跳过，首行是表头时跳过。行数超过上限抛 400 */
export function parseMailboxImport(content: string, extraTags: readonly string[]): ImportLine[] {
  const lines = content.split(/\r\n|\r|\n/u).map((text, index) => ({ text, lineNo: index + 1 }));
  const nonEmpty = lines.filter((line) => line.text.trim() !== "");
  if (nonEmpty.length > MAILBOX_LIMITS.importMaxLines) {
    throw new ApiError(HTTP_BAD_REQUEST, "too_many_lines", `一次最多导入 ${MAILBOX_LIMITS.importMaxLines} 行，本次 ${nonEmpty.length} 行`);
  }
  const parsed = nonEmpty.map((line) => ({ lineNo: line.lineNo, cells: splitImportLine(line.text) }));
  const first = parsed[0];
  if (first && HEADER_CELLS.has((first.cells[0] ?? "").toLowerCase())) parsed.shift();
  return parsed.map((line) => parseLine(line.lineNo, line.cells, extraTags));
}
