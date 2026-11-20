import { stripComments } from "./sql-guard";

// MAIL_DB 访问守卫（FIN-A）的扫描逻辑，自身的单测与对 src 的扫描在 mail-db-guard.test.ts。
//
// 规则：src/mail-source/ 之外，`MAIL_DB` 只能以"直接作为实参交给从 mail-source 导入的函数"的形态出现，
// 例如 `listCandidates(dbs.MAIL_DB, …)`。取出来赋给变量、解构、传给其他函数、在上面调 prepare 一律违规。
// 这样 MAIL_DB 的句柄只会落进 mail-source，而 mail-source 自身另有写语句禁令（mail-source-readonly.test.ts）。
// 类型声明逐个白名单（见测试里的 ALLOWED_DECLARATIONS）；需要携带 MAIL_DB 的类型用 mail-source 导出的 MailDbBinding。
// 注释、给人看的字符串（日志、错误消息）里的 MAIL_DB 不算出现；内容恰好是 "MAIL_DB" 的字符串算（`env["MAIL_DB"]`）。
// 已知限制：不识别正则字面量；模板字符串 ${} 内只按花括号配对，不处理其中再嵌套的字符串。

const TOKEN = "MAIL_DB";
const TOKEN_PATTERN = /\bMAIL_DB\b/g;
const MAIL_SOURCE_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["'](?:\.\.?\/)+mail-source(?:\/[\w.-]+)?["']/g;
const DIRECT_CALL = /([A-Za-z_$][\w$]*)\s*\(\s*(?:[A-Za-z_$][\w$]*\s*\??\.\s*)*MAIL_DB\s*[,)]/g;

type Scan = { text: string; next: number };

const blank = (text: string): string => text.replace(/[^\n]/g, " ");

/** 单引号 / 双引号字符串结束后的下标；遇到换行视为未闭合，停在换行处 */
function quotedEnd(code: string, start: number, quote: string): number {
  for (let index = start + 1; index < code.length; index++) {
    const char = code.charAt(index);
    if (char === "\\") index++;
    else if (char === quote) return index + 1;
    else if (char === "\n") return index;
  }
  return code.length;
}

/** 模板字符串里 ${ 之后的表达式原样保留，直到配对的 } */
function templateExpression(code: string, start: number): Scan {
  let depth = 0;
  for (let index = start; index < code.length; index++) {
    const char = code.charAt(index);
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return { text: code.slice(start, index + 1), next: index + 1 };
  }
  return { text: code.slice(start), next: code.length };
}

/** 模板字符串：文字部分换成空格，${} 表达式保留 */
function templateLiteral(code: string, start: number): Scan {
  let text = " ";
  let index = start + 1;
  while (index < code.length) {
    const char = code.charAt(index);
    if (char === "`") return { text: `${text} `, next: index + 1 };
    if (char === "$" && code.charAt(index + 1) === "{") {
      const expression = templateExpression(code, index + 1);
      text += `$${expression.text}`;
      index = expression.next;
      continue;
    }
    const width = char === "\\" ? 2 : 1;
    text += blank(code.slice(index, index + width));
    index += width;
  }
  return { text, next: code.length };
}

/** 把字符串字面量里的文字换成空格（长度、换行不变），内容恰好是 MAIL_DB 的保留 */
export function blankStringText(code: string): string {
  let output = "";
  let index = 0;
  while (index < code.length) {
    const char = code.charAt(index);
    if (char === '"' || char === "'") {
      const end = quotedEnd(code, index, char);
      const literal = code.slice(index, end);
      output += literal === `${char}${TOKEN}${char}` ? literal : blank(literal);
      index = end;
    } else if (char === "`") {
      const scanned = templateLiteral(code, index);
      output += scanned.text;
      index = scanned.next;
    } else {
      output += char;
      index++;
    }
  }
  return output;
}

/** 从 mail-source 导入的值（函数）名；type 导入不算 */
export function mailSourceImports(code: string): Set<string> {
  const names = new Set<string>();
  for (const match of code.matchAll(MAIL_SOURCE_IMPORT)) {
    for (const part of (match[1] ?? "").split(",")) {
      const item = part.trim();
      if (item === "" || item.startsWith("type ")) continue;
      names.add(item.split(/\s+as\s+/).at(-1) ?? item);
    }
  }
  return names;
}

/** imported 来自去注释但未去字符串的源码（导入路径本身是字符串） */
function directCallPositions(code: string, imported: ReadonlySet<string>): number[] {
  const positions: number[] = [];
  for (const match of code.matchAll(DIRECT_CALL)) {
    if (imported.has(match[1] ?? "")) positions.push(match.index + match[0].lastIndexOf(TOKEN));
  }
  return positions;
}

function declarationPositions(code: string, allowances: readonly RegExp[]): number[] {
  return allowances.flatMap((pattern) =>
    [...code.matchAll(new RegExp(pattern.source, "g"))].map((match) => match.index + match[0].indexOf(TOKEN)),
  );
}

function lineAt(code: string, position: number): string {
  const start = code.lastIndexOf("\n", position) + 1;
  const end = code.indexOf("\n", position);
  return code.slice(start, end === -1 ? code.length : end).trim();
}

/** 不在允许形态里的 MAIL_DB 所在行（去注释、去字符串文字之后的文本） */
export function findMailDbViolations(source: string, allowances: readonly RegExp[] = []): string[] {
  const stripped = stripComments(source);
  const code = blankStringText(stripped);
  const allowed = new Set([...directCallPositions(code, mailSourceImports(stripped)), ...declarationPositions(code, allowances)]);
  return [...code.matchAll(TOKEN_PATTERN)].filter((match) => !allowed.has(match.index)).map((match) => lineAt(code, match.index));
}

/** 白名单条目在文件里命中的次数（用于发现过期条目） */
export function countDeclarationHits(source: string, pattern: RegExp): number {
  return declarationPositions(blankStringText(stripComments(source)), [pattern]).length;
}
