// mail-source 只读守卫的扫描逻辑（01 §2：D1 没有只读 binding，只读靠代码保证）。
// 单独成文件是为了能对"去注释"和"规则"本身写单测。

/**
 * 扫描规则。原则：命中的必须是 SQL 语句形态，避免 `cache.delete(`、`str.replace(` 这类普通代码误报。
 * - 大写裸关键字：SQL 习惯写大写；JS 方法名都是小写，所以大写裸词基本只会是 SQL。
 * - 不区分大小写的语句形态：覆盖手写成小写的 SQL（`delete from`、`insert into` …）。
 */
export const FORBIDDEN_RULES: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "大写写入/改结构关键字", pattern: /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|REPLACE)\b/ },
  { name: "INSERT 语句", pattern: /\bINSERT\s+(OR\s+\w+\s+)?INTO\b/i },
  { name: "UPDATE 语句", pattern: /\bUPDATE\s+(OR\s+\w+\s+)?[\w"`[\].]+\s+SET\b/i },
  { name: "DELETE 语句", pattern: /\bDELETE\s+FROM\b/i },
  { name: "REPLACE INTO", pattern: /\bREPLACE\s+INTO\b/i },
  { name: "ALTER TABLE", pattern: /\bALTER\s+TABLE\b/i },
  { name: "DROP 语句", pattern: /\bDROP\s+(TABLE|INDEX|VIEW|TRIGGER)\b/i },
  { name: "CREATE 语句", pattern: /\bCREATE\s+(TEMP\s+|TEMPORARY\s+|UNIQUE\s+|VIRTUAL\s+)?(TABLE|INDEX|VIEW|TRIGGER)\b/i },
  // 白名单：只允许读表结构的 table_info / table_xinfo。函数写法也能赋值（`PRAGMA journal_mode(WAL)`），其余一律违规
  { name: "PRAGMA（仅允许 table_info/table_xinfo）", pattern: /\bPRAGMA\b(?!\s+(?:table_info|table_xinfo)\s*\()/i },
  { name: "VACUUM", pattern: /\bVACUUM\b/i },
  { name: "REINDEX", pattern: /\bREINDEX\b/i },
  { name: "ATTACH", pattern: /\bATTACH\s+(DATABASE\b|[\w'"?]+\s+AS\b)/i },
  { name: "大写 ATTACH/DETACH/VACUUM/REINDEX", pattern: /\b(ATTACH|DETACH|VACUUM|REINDEX)\b/ },
];

/**
 * 扫描前去掉注释，避免注释里的说明文字误报。
 * 逐字符扫描并识别字符串字面量：字符串里的 `//`、`/*` 不是注释，必须保留，也不能吞掉后面的代码。
 * 已知限制：不识别正则字面量。单引号/双引号字符串遇到换行即终止，所以正则里的引号最多影响所在行。
 */
export function stripComments(source: string): string {
  let output = "";
  let index = 0;
  while (index < source.length) {
    const token = readToken(source, index);
    output += token.text;
    index = token.next;
  }
  return output;
}

type Token = { text: string; next: number };

function readToken(source: string, index: number): Token {
  const char = source.charAt(index);
  const pair = source.slice(index, index + 2);
  if (pair === "//") {
    const end = source.indexOf("\n", index);
    // 保留换行，行号与相邻代码的分隔不变
    return { text: "", next: end === -1 ? source.length : end };
  }
  if (pair === "/*") {
    const end = source.indexOf("*/", index + 2);
    // 用空格代替，避免注释两侧的词被粘在一起
    return { text: " ", next: end === -1 ? source.length : end + 2 };
  }
  if (char === '"' || char === "'" || char === "`") {
    const next = skipString(source, index, char);
    return { text: source.slice(index, next), next };
  }
  return { text: char, next: index + 1 };
}

/** 返回字符串字面量结束后的下标 */
function skipString(source: string, start: number, quote: string): number {
  for (let index = start + 1; index < source.length; index++) {
    const char = source.charAt(index);
    if (char === "\\") {
      index++;
    } else if (char === quote) {
      return index + 1;
    } else if (char === "\n" && quote !== "`") {
      return index;
    }
  }
  return source.length;
}

export type Violation = { rule: string; match: string };

/** 返回源码（去注释后）命中的全部违规 */
export function findViolations(source: string): Violation[] {
  const code = stripComments(source);
  return FORBIDDEN_RULES.flatMap(({ name, pattern }) => {
    const match = pattern.exec(code);
    return match ? [{ rule: name, match: match[0] }] : [];
  });
}
