import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppEnv } from "../src/env";
import { app } from "../src/index";
import { assertReadonlySql, readonlyMailDb, withReadonlyMailDb } from "../src/mail-source";
import { setupMailDb } from "./helpers";
import { insertMail } from "./mail-helpers";

// MAIL_DB 运行时只读包装（src/mail-source/readonly-db.ts）。mail-source 的真实查询由 mail-source.test.ts、
// schema-probe.test.ts（直接经包装调用）与走 app / runScheduled 的集成测试覆盖，这里测判定规则本身与入口接线。

const ALLOWED = [
  "SELECT MAX(id) AS id FROM raw_mails",
  "  select 1 ;  ",
  "-- 说明\nSELECT 1",
  "/* 说明 */ SeLeCt 1",
  "PRAGMA table_info(raw_mails)",
  "pragma  TABLE_INFO( settings );",
  "SELECT ';' AS x",
  "SELECT 'a'';DELETE FROM raw_mails' AS x",
  'SELECT "a;b" FROM raw_mails',
  "SELECT [a;b] FROM raw_mails",
  "SELECT 1; -- 结尾注释\n",
  "SELECT 1 /* ; DELETE */",
];

const REJECTED: Array<[string, string]> = [
  ["INSERT INTO raw_mails (id) VALUES (1)", "拒绝 INSERT 语句"],
  ["UPDATE raw_mails SET raw = ''", "拒绝 UPDATE 语句"],
  ["DELETE FROM raw_mails", "拒绝 DELETE 语句"],
  ["REPLACE INTO raw_mails (id) VALUES (1)", "拒绝 REPLACE 语句"],
  ["CREATE TABLE x (a)", "拒绝 CREATE 语句"],
  ["DROP TABLE raw_mails", "拒绝 DROP 语句"],
  ["ALTER TABLE raw_mails ADD COLUMN x", "拒绝 ALTER 语句"],
  ["ATTACH DATABASE 'x' AS y", "拒绝 ATTACH 语句"],
  ["DETACH y", "拒绝 DETACH 语句"],
  ["VACUUM", "拒绝 VACUUM 语句"],
  ["REINDEX", "拒绝 REINDEX 语句"],
  ["PRAGMA journal_mode = WAL", "拒绝 PRAGMA 语句"],
  ["PRAGMA journal_mode(WAL)", "拒绝 PRAGMA 语句"],
  ["PRAGMA writable_schema = 1", "拒绝 PRAGMA 语句"],
  ["PRAGMA table_info(main.raw_mails)", "拒绝 PRAGMA 语句"],
  ["WITH x AS (SELECT 1) DELETE FROM raw_mails", "拒绝 WITH 语句"],
  ["EXPLAIN SELECT 1", "拒绝 EXPLAIN 语句"],
  ["BEGIN", "拒绝 BEGIN 语句"],
  ["/* */ INSERT INTO raw_mails (id) VALUES (1)", "拒绝 INSERT 语句"],
  ["-- \n DELETE FROM raw_mails", "拒绝 DELETE 语句"],
  ["/* SELECT */ DELETE FROM raw_mails", "拒绝 DELETE 语句"],
  ["InSeRt INTO raw_mails (id) VALUES (1)", "拒绝 INSERT 语句"],
  ["dElEtE FROM raw_mails", "拒绝 DELETE 语句"],
  ["SELECT 1; DELETE FROM raw_mails", "拒绝 多条语句"],
  ["SELECT 1;/* */DELETE FROM raw_mails", "拒绝 多条语句"],
  ["SELECT 1;\n-- x\nDROP TABLE raw_mails", "拒绝 多条语句"],
  ["PRAGMA table_info(raw_mails); DELETE FROM raw_mails", "拒绝 多条语句"],
  ["SELECT 1;;", "拒绝 多条语句"],
  ["", "拒绝 空语句或不以关键字开头的语句"],
  ["   -- 只有注释", "拒绝 空语句或不以关键字开头的语句"],
  ["(SELECT 1)", "拒绝 空语句或不以关键字开头的语句"],
];

describe("只读判定规则", () => {
  it.each(ALLOWED)("放行：%j", (sql) => {
    expect(() => assertReadonlySql(sql)).not.toThrow();
  });

  it.each(REJECTED)("拒绝：%j", (sql, message) => {
    expect(() => assertReadonlySql(sql)).toThrow(`MAIL_DB 只读：${message}`);
  });
});

describe("只读包装的 D1 句柄", () => {
  beforeEach(() => setupMailDb());

  const countRows = async () => (await env.MAIL_DB.prepare("SELECT COUNT(*) AS n FROM raw_mails").first<{ n: number }>())?.n;

  it("prepare 放行读语句、拒绝写语句；被拒的语句不会到达数据库", async () => {
    await insertMail({ address: "a@example.com" });
    const db = readonlyMailDb(env.MAIL_DB);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM raw_mails WHERE address = ?1").bind("a@example.com").first("n")).toBe(1);
    expect(() => db.prepare("DELETE FROM raw_mails")).toThrow("MAIL_DB 只读：拒绝 DELETE 语句");
    expect(() => db.prepare("SELECT 1; DELETE FROM raw_mails")).toThrow("MAIL_DB 只读：拒绝 多条语句");
    expect(await countRows()).toBe(1);
  });

  it("exec、withSession、dump 一律拒绝", async () => {
    const db = readonlyMailDb(env.MAIL_DB);
    expect(() => db.exec("SELECT 1")).toThrow("MAIL_DB 只读：拒绝 exec");
    expect(() => db.withSession("first-primary")).toThrow("MAIL_DB 只读：拒绝 withSession");
    expect(() => db.dump()).toThrow("MAIL_DB 只读：拒绝 dump");
  });

  it("batch 只接受经包装 prepare（含 bind 之后）的语句", async () => {
    await insertMail({ address: "a@example.com" });
    const db = readonlyMailDb(env.MAIL_DB);
    const results = await db.batch<{ n: number }>([
      db.prepare("SELECT COUNT(*) AS n FROM raw_mails"),
      db.prepare("SELECT COUNT(*) AS n FROM raw_mails WHERE address = ?1").bind("nobody@example.com"),
    ]);
    expect(results.map((result) => result.results[0]?.n)).toEqual([1, 0]);
    expect(() => db.batch([env.MAIL_DB.prepare("DELETE FROM raw_mails")])).toThrow("MAIL_DB 只读：拒绝 batch 里未经只读包装 prepare 的语句");
    const other = readonlyMailDb(env.APP_DB);
    expect(() => db.batch([other.prepare("SELECT 1")])).toThrow("MAIL_DB 只读：拒绝 batch");
    expect(await countRows()).toBe(1);
  });

  it("包装对象与语句对象上取不到原始句柄（私有字段，无自有属性）", () => {
    const db = readonlyMailDb(env.MAIL_DB);
    const statement = db.prepare("SELECT 1");
    const bound = db.prepare("SELECT ?1").bind(1);
    for (const target of [db, statement, bound]) {
      expect(Object.keys(target)).toEqual([]);
      expect(Object.getOwnPropertyNames(target)).toEqual([]);
      expect(Reflect.ownKeys(target)).toEqual([]);
      expect(JSON.stringify(target)).toBe("{}");
      const enumerable: string[] = [];
      for (const key in target) enumerable.push(key);
      expect(enumerable).toEqual([]);
      // 原型上只有方法
      const proto: object = Object.getPrototypeOf(target);
      for (const key of Reflect.ownKeys(proto)) expect(typeof Reflect.get(proto, key)).toBe("function");
    }
    expect(Reflect.get(db, "inner")).toBeUndefined();
    expect(Reflect.get(statement, "owner")).toBeUndefined();
    expect(Reflect.get(statement, "inner")).toBeUndefined();
  });

  it("重复包装原样返回；withReadonlyMailDb 返回新对象，不改入参", () => {
    const db = readonlyMailDb(env.MAIL_DB);
    expect(readonlyMailDb(db)).toBe(db);
    const input = { APP_DB: env.APP_DB, MAIL_DB: env.MAIL_DB };
    const wrapped = withReadonlyMailDb(input);
    expect(wrapped).not.toBe(input);
    expect(input.MAIL_DB).toBe(env.MAIL_DB);
    expect(wrapped.APP_DB).toBe(env.APP_DB);
    expect(withReadonlyMailDb(wrapped)).toBe(wrapped);
  });
});

describe("入口接线", () => {
  it("app 的请求里，处理函数拿到的 MAIL_DB 是只读包装", async () => {
    // 新建一个 Hono 挂载真实 app（含它的第一个中间件），再加一个探针路由；不改共享的 app 实例
    const probe = new Hono<AppEnv>().route("/", app).get("/__readonly-probe", (c) => {
      try {
        void c.env.MAIL_DB.exec("DELETE FROM raw_mails");
        return c.text("未包装");
      } catch (error) {
        return c.text(error instanceof Error ? error.message : String(error));
      }
    });
    const res = await probe.request("/__readonly-probe", {}, env);
    expect(await res.text()).toBe("MAIL_DB 只读：拒绝 exec（exec 不做语句检查，一律不允许）");
  });
});
