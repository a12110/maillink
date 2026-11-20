import { describe, expect, it } from "vitest";
import { blankStringText, countDeclarationHits, findMailDbViolations, mailSourceImports } from "./mail-db-guard";

// MAIL_DB 访问守卫（FIN-A，AGENTS.md"唯一接触 MAIL_DB 的目录是 mail-source"）：
// src/ 下 mail-source/ 之外的源码，MAIL_DB 只能直接作为实参交给从 mail-source 导入的函数；
// mail-source/ 内的写语句禁令见 mail-source-readonly.test.ts。规则与已知限制见 mail-db-guard.ts。
const sources = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true });
const outside = Object.entries(sources).filter(([file]) => !file.startsWith("../src/mail-source/")) as Array<[string, string]>;

/** 逐个白名单的类型声明：文件（相对 src/）→ 允许的写法与理由 */
const ALLOWED_DECLARATIONS: ReadonlyArray<{ file: string; pattern: RegExp; reason: string }> = [
  { file: "env.ts", pattern: /\bMAIL_DB:\s*D1Database;/, reason: "Worker 绑定本身的类型声明；其余类型一律用 mail-source 的 MailDbBinding" },
];

const allowancesFor = (file: string) =>
  ALLOWED_DECLARATIONS.filter((entry) => file === `../src/${entry.file}`).map((entry) => entry.pattern);

describe("MAIL_DB 访问守卫：src 中 mail-source 之外", () => {
  it("确实扫描到了 mail-source 之外的源码，包括已知要把 MAIL_DB 交给 mail-source 的文件", () => {
    const files = outside.map(([file]) => file);
    expect(files.length).toBeGreaterThan(50);
    for (const name of ["env.ts", "access/list.ts", "access/detail.ts", "mail-index/index.ts", "routes/admin-mails.ts", "routes/admin-system.ts", "cron/prewarm.ts", "inbox/locate.ts"]) {
      expect(files, name).toContain(`../src/${name}`);
    }
    expect(files.some((file) => file.includes("/mail-source/"))).toBe(false);
  });

  it("除白名单声明外，MAIL_DB 只直接交给从 mail-source 导入的函数", () => {
    const offenders = outside.flatMap(([file, source]) =>
      findMailDbViolations(source, allowancesFor(file)).map((line) => `${file}: ${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it("白名单每条都恰好命中一次（没有过期或过宽的条目）", () => {
    for (const entry of ALLOWED_DECLARATIONS) {
      const source = sources[`../src/${entry.file}`];
      expect(typeof source, entry.file).toBe("string");
      expect(countDeclarationHits(source as string, entry.pattern), `${entry.file}: ${entry.reason}`).toBe(1);
    }
  });
});

const HEADER = 'import { getRawBatch, listCandidates as list, type MailCandidate } from "../mail-source";\nimport { helper } from "./helper";\n';
const hits = (body: string, allowances: RegExp[] = []) => findMailDbViolations(HEADER + body, allowances);

describe("守卫本身", () => {
  it("违规形态都会被报出", () => {
    const cases = [
      'await c.env.MAIL_DB.prepare("DELETE FROM raw_mails").run();',
      "const db = c.env.MAIL_DB;",
      "const { MAIL_DB } = c.env;",
      "await helper(c.env.MAIL_DB, 1);",
      'await c.env["MAIL_DB"].prepare("SELECT 1").first();',
      "type Dbs = { MAIL_DB: D1Database };",
      "const x = `${env.MAIL_DB}`;",
      "await getRawBatch(wrap(c.env.MAIL_DB), [1]);",
      "await MailCandidate(c.env.MAIL_DB);",
    ];
    for (const body of cases) expect(hits(body), body).toHaveLength(1);
  });

  it("允许的形态不报：直接实参（含别名导入）、注释、日志与错误消息、模板字符串文字、白名单声明", () => {
    const body = [
      "const raws = await getRawBatch(dbs.MAIL_DB, ids);",
      "const rows = await list(c.env.MAIL_DB, { limit: 1 });",
      "// MAIL_DB 只读",
      "/* env.MAIL_DB.prepare() */",
      'console.error("health check: MAIL_DB 探测失败", error);',
      "throw new Error(`超过 ${max} 个，无法一次传给 MAIL_DB`);",
      "type Bindings = { MAIL_DB: D1Database; };",
    ].join("\n");
    expect(hits(body, [/\bMAIL_DB:\s*D1Database;/])).toEqual([]);
  });

  it("只认从 mail-source 导入的值：type 导入、其他模块的同名函数都不算", () => {
    expect([...mailSourceImports(HEADER)].sort()).toEqual(["getRawBatch", "list"]);
    expect(mailSourceImports('import { listAfter } from "../mail-source/candidates";')).toEqual(new Set(["listAfter"]));
    expect(mailSourceImports('import { listAfter } from "../not-mail-source";').size).toBe(0);
    expect(mailSourceImports('import type { MailDbBinding } from "../mail-source";').size).toBe(0);
  });

  it("字符串文字换成空格，长度与换行不变；恰好是 \"MAIL_DB\" 的字符串保留", () => {
    const code = 'a("x MAIL_DB y"); b["MAIL_DB"]; c(`t ${d.MAIL_DB} \\` u`);\n\'q\'';
    const blanked = blankStringText(code);
    expect(blanked).toHaveLength(code.length);
    expect(blanked).toContain('b["MAIL_DB"]');
    expect(blanked).toContain("${d.MAIL_DB}");
    expect(blanked).not.toContain("x MAIL_DB y");
    expect(blanked.split("\n")).toHaveLength(2);
  });
});
