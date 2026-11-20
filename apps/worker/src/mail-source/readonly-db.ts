import type { MailDbBinding } from "./types";

// MAIL_DB 运行时只读包装（AGENTS.md 硬性规则的第二层；第一层是 scripts/mail-db-guard.ts 的静态守卫）。
// 入口（index.ts 的第一个中间件、cron/index.ts 的 runScheduled）把 env.MAIL_DB 换成这里的包装，
// 之后无论代码以什么写法拿到 MAIL_DB，能执行的都只有下面放行的读语句。
//
// 放行规则（只覆盖 mail-source 实际用到的两类语句）：
// - 去掉前导空白与注释（`-- …` 到行尾、`/* … */`，未闭合的块注释吞到结尾）后，首个关键字不区分大小写地等于 select；
// - 或整条语句（合并空白、去掉括号两侧空白、转小写后）恰好是 `pragma table_info(<标识符>)`，可带结尾分号；
//   中间夹注释、带 schema 前缀（main.x）都不放行。
// 其余一律抛错：写语句、改结构、attach / detach、vacuum、其他 pragma（含函数写法赋值）、explain、
// 以 with 开头的语句（with 后面可以接写语句，mail-source 也不用）、以括号或非关键字开头、空语句。
// 多语句：分号之后（跳过字符串、引号标识符、注释）只能是空白或注释，否则拒绝。
// 边界：select 的内容不做解析——SQLite 的 select 本身不能改数据，D1 也不开放有副作用的扩展函数；
// 未闭合的字符串字面量不在这里报错，交给 SQLite 报语法错误。
// exec 一律拒绝；batch 只接受本包装 prepare 出来的语句；withSession / dump 不提供。

const REJECT_PREFIX = "MAIL_DB 只读：拒绝";
const TABLE_INFO_PREFIX = "pragma table_info(";
const TABLE_INFO_REST = /^[a-z_][a-z0-9_]*\)$/;
const LEADING_KEYWORD = /^[a-z_][a-z0-9_$]*/i;
const WHITESPACE = /\s/;

function reject(what: string): Error {
  return new Error(`${REJECT_PREFIX} ${what}`);
}

/** 从 start 起跳过空白与注释，返回第一个有效字符的下标（没有则为 sql.length） */
function skipTrivia(sql: string, start: number): number {
  let index = start;
  while (index < sql.length) {
    if (WHITESPACE.test(sql.charAt(index))) {
      index += 1;
    } else if (sql.startsWith("--", index)) {
      const end = sql.indexOf("\n", index);
      index = end === -1 ? sql.length : end + 1;
    } else if (sql.startsWith("/*", index)) {
      const end = sql.indexOf("*/", index + 2);
      index = end === -1 ? sql.length : end + 2;
    } else {
      return index;
    }
  }
  return index;
}

const CLOSING: Record<string, string> = { "'": "'", '"': '"', "`": "`", "[": "]" };

/** 第一条语句的结束下标：第一个不在字符串 / 引号标识符 / 注释里的分号；没有分号为 sql.length */
function statementEnd(sql: string, start: number): number {
  let index = start;
  while (index < sql.length) {
    const char = sql.charAt(index);
    const closing = CLOSING[char];
    if (char === ";") return index;
    if (closing !== undefined) {
      // SQLite 的 '' 转义等价于"关闭后立刻重新打开"，逐段跳过即可
      const end = sql.indexOf(closing, index + 1);
      index = end === -1 ? sql.length : end + 1;
    } else if (sql.startsWith("--", index) || sql.startsWith("/*", index)) {
      index = skipTrivia(sql, index);
    } else {
      index += 1;
    }
  }
  return index;
}

function isTableInfo(statement: string): boolean {
  const normalized = statement.replace(/\s+/g, " ").replace(/ ?([()]) ?/g, "$1").trim().toLowerCase();
  return normalized.startsWith(TABLE_INFO_PREFIX) && TABLE_INFO_REST.test(normalized.slice(TABLE_INFO_PREFIX.length));
}

/** 不是允许的读语句就抛错（规则见文件头） */
export function assertReadonlySql(sql: string): void {
  const start = skipTrivia(sql, 0);
  const end = statementEnd(sql, start);
  if (end < sql.length && skipTrivia(sql, end + 1) < sql.length) throw reject("多条语句");
  const statement = sql.slice(start, end);
  const keyword = LEADING_KEYWORD.exec(statement)?.[0].toLowerCase();
  if (keyword === "select" || isTableInfo(statement)) return;
  throw reject(keyword === undefined ? "空语句或不以关键字开头的语句" : `${keyword.toUpperCase()} 语句`);
}

class ReadonlyStatement implements D1PreparedStatement {
  constructor(
    readonly owner: D1Database,
    readonly inner: D1PreparedStatement,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new ReadonlyStatement(this.owner, this.inner.bind(...values));
  }

  first<T>(colName?: string): Promise<T | null> {
    return colName === undefined ? this.inner.first<T>() : this.inner.first<T>(colName);
  }

  run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.inner.run<T>();
  }

  all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.inner.all<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<[string[], ...T[]] | T[]> {
    return options?.columnNames === true ? this.inner.raw<T>({ columnNames: true }) : this.inner.raw<T>();
  }
}

class ReadonlyMailDb implements D1Database {
  constructor(private readonly inner: D1Database) {}

  prepare(query: string): D1PreparedStatement {
    assertReadonlySql(query);
    return new ReadonlyStatement(this.inner, this.inner.prepare(query));
  }

  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const inner = statements.map((statement) => {
      if (statement instanceof ReadonlyStatement && statement.owner === this.inner) return statement.inner;
      throw reject("batch 里未经只读包装 prepare 的语句");
    });
    return this.inner.batch<T>(inner);
  }

  exec(_query: string): Promise<D1ExecResult> {
    throw reject("exec（exec 不做语句检查，一律不允许）");
  }

  withSession(): D1DatabaseSession {
    throw reject("withSession（mail-source 不使用会话）");
  }

  dump(): Promise<ArrayBuffer> {
    throw reject("dump");
  }
}

/** 包一层只读；已经包过的原样返回 */
export function readonlyMailDb(db: D1Database): D1Database {
  return db instanceof ReadonlyMailDb ? db : new ReadonlyMailDb(db);
}

/**
 * 返回 MAIL_DB 换成只读包装的 env 浅拷贝，不改入参。
 * 没有绑定 MAIL_DB（如测试里只给部分绑定）时原样返回：首次使用时照常报错，不在这里伪造一个句柄。
 */
export function withReadonlyMailDb<E extends MailDbBinding>(env: E): E {
  const db: D1Database | undefined = env.MAIL_DB;
  if (db === undefined || db instanceof ReadonlyMailDb) return env;
  return { ...env, MAIL_DB: new ReadonlyMailDb(db) };
}
