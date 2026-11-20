// MAIL_DB 访问守卫的测试（node --test，见 package.json 的 test 脚本）：先用夹具字符串验证每种绕过都会被报出，
// 再扫描真实的 apps/worker/src。夹具只在内存里，不放进 src。

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { findMailDbViolations, loadWorkerProgram } from "./mail-db-guard.ts";

const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = "/virtual";
const SRC = `${ROOT}/src`;

const BASE_FILES: Record<string, string> = {
  [`${SRC}/env.ts`]: [
    "export type D1 = { prepare(sql: string): unknown };",
    "export type Bindings = { APP_DB: D1; MAIL_DB: D1; APP_SECRET?: string };",
    "export type Ctx = { env: Bindings };",
  ].join("\n"),
  [`${SRC}/mail-source/raw.ts`]: 'import type { D1 } from "../env";\nexport function getRawBatch(db: D1, ids: number[]): number[] {\n  void db;\n  return ids;\n}\n',
  [`${SRC}/mail-source/index.ts`]: 'export { getRawBatch } from "./raw";\nexport type MailDbBinding = { MAIL_DB: import("../env").D1 };\n',
  [`${SRC}/helper.ts`]: 'import type { D1 } from "./env";\nexport function helper(db: D1): D1 {\n  return db;\n}\n',
};

const HEADER = [
  'import { getRawBatch, getRawBatch as raw } from "../mail-source";',
  'import type { MailDbBinding } from "../mail-source";',
  'import { helper } from "../helper";',
  'import type { Bindings, Ctx, D1 } from "../env";',
  "declare const env: Bindings;",
  "declare const c: Ctx;",
  "void [getRawBatch, raw, helper, c];",
  "export type _D1 = D1;",
  "export type _Uses = MailDbBinding;",
].join("\n");

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
  strict: true,
  noEmit: true,
  types: [],
};

/** 内存里的小项目：src/routes/case.ts 是被测夹具，其余是假的 env 与 mail-source */
function virtualProgram(body: string, extra: Record<string, string> = {}): ts.Program {
  const files: Record<string, string> = { ...BASE_FILES, ...extra, [`${SRC}/routes/case.ts`]: `${HEADER}\n${body}\n` };
  const host = ts.createCompilerHost(OPTIONS);
  const realGet = host.getSourceFile.bind(host);
  const realExists = host.fileExists.bind(host);
  const realRead = host.readFile.bind(host);
  host.getSourceFile = (name, version) =>
    name in files ? ts.createSourceFile(name, files[name] ?? "", version) : realGet(name, version);
  host.fileExists = (name) => name in files || (!name.startsWith(ROOT) && realExists(name));
  host.readFile = (name) => files[name] ?? (name.startsWith(ROOT) ? undefined : realRead(name));
  host.directoryExists = (dir) => dir.startsWith(ROOT) || ts.sys.directoryExists(dir);
  return ts.createProgram({ rootNames: Object.keys(files), options: OPTIONS, host });
}

function rulesHit(body: string): string[] {
  const program = virtualProgram(body);
  const diagnostics = program.getSyntacticDiagnostics();
  assert.equal(diagnostics.length, 0, `夹具语法错误：${body}`);
  return findMailDbViolations(program, SRC).filter((v) => v.file.startsWith("routes")).map((v) => v.rule);
}

const BYPASSES: Array<[string, string, string]> = [
  ["模板字符串计算属性", "env[`MAIL_DB`].prepare('x');", "env_computed_access"],
  ["拼接字符串计算属性", 'env["MAIL" + "_DB"].prepare("x");', "env_computed_access"],
  ["变量计算属性", "const k = 'APP_DB' as keyof Bindings; void env[k];", "env_computed_access"],
  ["Object.values(env)", "void Object.values(env);", "env_escape"],
  ["Object.entries(env)", "void Object.entries(env);", "env_escape"],
  ["Object.assign 拷贝", "void Object.assign({}, c.env);", "env_escape"],
  ["JSON.stringify(env)", "void JSON.stringify(env);", "env_escape"],
  ["for…in 遍历", "for (const k in env) void k;", "env_escape"],
  ["收窄类型后整体枚举", 'export function narrow(e: Pick<Bindings, "APP_SECRET">) {\n  return Object.keys(e);\n}', "env_escape"],
  ["对象展开", "const copy = { ...env };\nvoid copy;", "env_spread"],
  ["剩余解构", "const { APP_SECRET, ...rest } = env;\nvoid [APP_SECRET, rest];", "env_spread"],
  ["同名方法冒充 mail-source", "const evil = { getRawBatch: (db: unknown, ids: number[]) => [db, ids] };\nevil.getRawBatch(env.MAIL_DB, [1]);", "mail_db_access"],
  ["局部别名", "const f = getRawBatch;\nf(env.MAIL_DB, [1]);", "mail_db_access"],
  ["交给 src 里的其他函数", "helper(env.MAIL_DB);", "mail_db_access"],
  ["取出来赋值", "const db = env.MAIL_DB;\nvoid db;", "mail_db_access"],
  ["包一层再传", "getRawBatch((env.MAIL_DB), [1]);", "mail_db_access"],
  ["调用结果上取", "const get = () => env;\ngetRawBatch(get().MAIL_DB, [1]);", "mail_db_access"],
  ["解构取出", "const { MAIL_DB } = env;\nvoid MAIL_DB;", "mail_db_name"],
  ["类型里声明", "export type Dbs = { MAIL_DB: unknown };", "mail_db_name"],
  ["字符串键", 'export type Picked = Pick<Bindings, "MAIL_DB">;', "mail_db_string"],
  ["断言成 unknown", "const hidden = env as unknown;\nvoid hidden;", "env_erasure"],
  ["交给 unknown 形参", "function sink(x: unknown) {\n  return x;\n}\nsink(c.env);", "env_erasure"],
  // 终验复核（fable）的三种泛型写法，原样搬来（D1Database 换成夹具里的 D1）
  [
    "终验复核 1：无约束泛型 pick 取属性",
    [
      "function pick<T, K extends keyof T>(o: T, k: K): T[K] {",
      "  return o[k];",
      "}",
      'const key = ("MAIL" + "_DB") as "APP_DB";',
      'void pick(c.env, key).prepare("DELETE FROM raw_mails");',
    ].join("\n"),
    "env_erasure",
  ],
  [
    "终验复核 2：无约束泛型里洗成 Record",
    [
      "function launder<T>(x: T): Record<string, D1> {",
      "  return x as unknown as Record<string, D1>;",
      "}",
      'void launder(c.env)["MAIL" + "_DB"]?.prepare("DELETE FROM raw_mails");',
    ].join("\n"),
    "env_erasure",
  ],
  [
    "终验复核 3：泛型类持有 env",
    [
      "class Holder<T> {",
      "  constructor(readonly value: T) {}",
      "  read<K extends keyof T>(k: K): T[K] {",
      "    return this.value[k];",
      "  }",
      "}",
      "const holder = new Holder(c.env);",
      'void holder.read(("MAIL_" + "DB") as "APP_DB").prepare("DROP TABLE raw_mails");',
    ].join("\n"),
    "env_erasure",
  ],
  ["类型参数约束为 object", "function wide<T extends object>(x: T) {\n  return x;\n}\nwide(env);", "env_erasure"],
  ["类型参数约束为 Record", "function rec<T extends Record<string, unknown>>(x: T) {\n  return x;\n}\nrec(env);", "env_erasure"],
  ["类型参数约束为 unknown", "function unk<T extends unknown>(x: T) {\n  return x;\n}\nunk(env);", "env_erasure"],
  ["rest 形参是泛型数组", "function many<T>(...xs: T[]) {\n  return xs;\n}\nmany(env);", "env_erasure"],
  ["从 cloudflare:workers 导入 env", 'import { env as workersEnv } from "cloudflare:workers";\nvoid workersEnv;', "workers_env_import"],
  ["导入 env 不用别名", 'import { env } from "cloudflare:workers";\nvoid env;', "workers_env_import"],
  ["命名空间导入后取 env", 'import * as W from "cloudflare:workers";\nvoid W.env;', "workers_env_import"],
  ["命名空间导入后计算属性取", 'import * as W from "cloudflare:workers";\nvoid W["e" + "nv"];', "workers_env_import"],
  ["命名空间整个交出去", 'import * as W from "cloudflare:workers";\nvoid Object.values(W);', "workers_env_import"],
  ["默认导入后取 env", 'import W from "cloudflare:workers";\nvoid W.env;', "workers_env_import"],
  ["转导出 env", 'export { env } from "cloudflare:workers";', "workers_env_import"],
  ["export * 转导出", 'export * from "cloudflare:workers";', "workers_env_import"],
  ["动态 import", 'void import("cloudflare:workers").then((m) => m);', "workers_env_import"],
  ["实参多于形参（经 arguments 取）", "function none() {\n  return arguments[0];\n}\nnone(env);", "env_erasure"],
];

describe("MAIL_DB 守卫：每种绕过都会被报出", () => {
  for (const [label, body, rule] of BYPASSES) {
    it(label, () => {
      assert.ok(rulesHit(body).includes(rule), `期望 ${rule}，实际 ${JSON.stringify(rulesHit(body))}`);
    });
  }
});

describe("MAIL_DB 守卫：允许的写法不报", () => {
  it("直接实参（含别名导入、标识符链）、交给带 MailDbBinding 类型的函数、注释与日志字符串", () => {
    const body = [
      "getRawBatch(env.MAIL_DB, [1]);",
      "raw(c.env.MAIL_DB, [2]);",
      "export function viaBinding(source: MailDbBinding) {",
      "  return getRawBatch(source.MAIL_DB, [3]);",
      "}",
      "viaBinding(env);",
      "export function viaGeneric<E extends MailDbBinding>(source: E) {",
      "  return getRawBatch(source.MAIL_DB, [4]);",
      "}",
      "viaGeneric(env);",
      "export function viaBindings<E extends Bindings>(source: E) {",
      "  return source.APP_DB;",
      "}",
      "viaBindings(c.env);",
      'export type _Workers = import("cloudflare:workers").WorkerEntrypoint;',
      "// env.MAIL_DB.prepare('DELETE')",
      'console.error("health check: MAIL_DB 探测失败");',
      "void env.APP_DB.prepare('SELECT 1');",
      "void c.env.APP_SECRET;",
    ].join("\n");
    assert.deepEqual(rulesHit(body), []);
  });
});

describe("MAIL_DB 守卫：cloudflare:workers 的 env 在 mail-source 里同样禁止", () => {
  it("mail-source 下导入 env 报出，取模块里别的导出不报", () => {
    const files = {
      [`${SRC}/mail-source/evil.ts`]: 'import { env } from "cloudflare:workers";\nexport const leaked = env;\n',
      [`${SRC}/mail-source/fine.ts`]: 'import * as W from "cloudflare:workers";\nexport type Entry = W.WorkerEntrypoint;\nexport const Base = W.DurableObject;\n',
    };
    const hits = findMailDbViolations(virtualProgram("", files), SRC).filter((v) => v.file.startsWith("mail-source"));
    assert.deepEqual(hits.map((v) => `${v.file}:${v.rule}`), ["mail-source/evil.ts:workers_env_import"]);
  });
});

describe("MAIL_DB 守卫：apps/worker/src", () => {
  it("没有违规", () => {
    const program = loadWorkerProgram(WORKER_DIR);
    const scanned = program.getSourceFiles().filter((file) => file.fileName.includes("/apps/worker/src/"));
    assert.ok(scanned.length > 100, `只扫到 ${scanned.length} 个文件`);
    const offenders = findMailDbViolations(program, path.join(WORKER_DIR, "src")).map((v) => `${v.file}:${v.line} [${v.rule}] ${v.text}`);
    assert.deepEqual(offenders, []);
  });
});
