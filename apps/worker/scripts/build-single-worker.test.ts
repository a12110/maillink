// build-single-worker.ts 的纯函数测试（node --test）：_headers 解析、前端清单、迁移改写成 D1 控制台 SQL。
// 打包本身（wrangler --dry-run）由 `pnpm --filter worker build:single` 与 CI 覆盖。

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  APP_DB_PROBE,
  assetFor,
  buildAssetManifest,
  buildConsoleSql,
  buildSingleMigrationSql,
  parseHeadersFile,
  readMigrations,
  toConsoleStatements,
} from "./build-single-worker.ts";

const migrationsPath = join(import.meta.dirname, "../migrations");

const HEADERS = [
  "/*",
  "  Content-Security-Policy: default-src 'self'; frame-ancestors 'none'",
  "  X-Content-Type-Options: nosniff",
  "/s/*",
  "  Cache-Control: no-store",
  "",
].join("\n");

function withDist(files: Record<string, string>, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "single-dist-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(dir, name, ".."), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("parseHeadersFile", () => {
  it("解析路径与响应头，值里的冒号与分号原样保留", () => {
    assert.deepEqual(parseHeadersFile(HEADERS), [
      {
        pattern: "/*",
        headers: [
          ["Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'"],
          ["X-Content-Type-Options", "nosniff"],
        ],
      },
      { pattern: "/s/*", headers: [["Cache-Control", "no-store"]] },
    ]);
  });

  it("跳过空行与 # 注释", () => {
    assert.deepEqual(parseHeadersFile("# 注释\n\n/a\n  X-A: 1\n"), [{ pattern: "/a", headers: [["X-A", "1"]] }]);
  });

  it("不支持的写法直接失败", () => {
    assert.throws(() => parseHeadersFile("/:id/x\n  X-A: 1\n"), /不支持的路径写法/);
    assert.throws(() => parseHeadersFile("/a/*/b\n  X-A: 1\n"), /不支持的路径写法/);
    assert.throws(() => parseHeadersFile("https://example.com/*\n  X-A: 1\n"), /不支持的路径写法/);
    assert.throws(() => parseHeadersFile("/*\n  ! X-A\n"), /不支持的写法/);
    assert.throws(() => parseHeadersFile("  X-A: 1\n"), /不支持的写法/);
    assert.throws(() => parseHeadersFile("/*\n/s/*\n  X-A: 1\n"), /没有任何响应头/);
  });
});

describe("buildAssetManifest", () => {
  it("收录前端文件，_headers 转成规则而不作为文件下发", () => {
    withDist(
      { "index.html": "<!doctype html>", "assets/app-1.js": "console.log(1)", "logo.png": "\u0089PNG", _headers: HEADERS },
      (dir) => {
        const manifest = buildAssetManifest(dir);
        assert.deepEqual(Object.keys(manifest.files).sort(), ["/assets/app-1.js", "/index.html", "/logo.png"]);
        assert.equal(manifest.spaFallback, "/index.html");
        assert.equal(manifest.headerRules.length, 2);
        assert.deepEqual(manifest.files["/assets/app-1.js"], {
          contentType: "text/javascript; charset=utf-8",
          encoding: "utf8",
          body: "console.log(1)",
        });
        assert.equal(manifest.files["/logo.png"]?.encoding, "base64");
      },
    );
  });

  it("缺 index.html 或 _headers、出现 _redirects、未知类型、需要编码的文件名都失败", () => {
    withDist({ _headers: HEADERS }, (dir) => assert.throws(() => buildAssetManifest(dir), /index\.html/));
    withDist({ "index.html": "x" }, (dir) => assert.throws(() => buildAssetManifest(dir), /_headers/));
    withDist({ "index.html": "x", _headers: HEADERS, _redirects: "/a /b" }, (dir) =>
      assert.throws(() => buildAssetManifest(dir), /_redirects/),
    );
    withDist({ "index.html": "x", _headers: HEADERS, "a.map": "{}" }, (dir) =>
      assert.throws(() => buildAssetManifest(dir), /不认识的前端文件类型/),
    );
    withDist({ "index.html": "x", _headers: HEADERS, "a b.js": "" }, (dir) =>
      assert.throws(() => buildAssetManifest(dir), /需要编码/),
    );
  });

  it("二进制文件按 base64 原样保存", () => {
    const bytes = Buffer.from([0, 255, 16, 128]);
    assert.deepEqual(assetFor("/x.png", bytes), { contentType: "image/png", encoding: "base64", body: "AP8QgA==" });
  });
});

describe("toConsoleStatements", () => {
  it("去掉注释、压缩空白、每条语句一行", () => {
    const sql = [
      "-- 头部注释",
      "CREATE TABLE a (",
      "  id INTEGER PRIMARY KEY, -- 行尾注释",
      "  /* 块注释 */ name TEXT NOT NULL",
      ");",
      "",
      "CREATE INDEX idx_a ON a(name);",
    ].join("\n");
    assert.deepEqual(toConsoleStatements(sql, "t"), [
      "CREATE TABLE a ( id INTEGER PRIMARY KEY, name TEXT NOT NULL );",
      "CREATE INDEX idx_a ON a(name);",
    ]);
  });

  it("字符串与带引号的标识符里的 --、分号、连续空格原样保留", () => {
    const sql = `INSERT INTO "my  table" (v) VALUES ('a -- b;  c', 'it''s');`;
    assert.deepEqual(toConsoleStatements(sql, "t"), [sql]);
  });

  it("减号与除号不被当成注释", () => {
    assert.deepEqual(toConsoleStatements("SELECT 3 - 1, 4 / 2;", "t"), ["SELECT 3 - 1, 4 / 2;"]);
  });

  it("跨行字符串、未闭合引号、缺分号都失败", () => {
    assert.throws(() => toConsoleStatements("SELECT 'a\nb';", "t"), /字符串跨行/);
    assert.throws(() => toConsoleStatements("SELECT 'a;", "t"), /未闭合的引号/);
    assert.throws(() => toConsoleStatements("SELECT 1", "t"), /缺少分号/);
  });
});

describe("buildConsoleSql", () => {
  const migrations = [
    { name: "0001_init.sql", sql: "-- x\nCREATE TABLE users (id INTEGER);\n" },
    { name: "0002_more.sql", sql: "CREATE TABLE b (id INTEGER);\nCREATE INDEX i ON b(id);\n" },
  ];

  it("迁移语句在前，迁移记录表与记录在最后，没有注释", () => {
    const lines = buildConsoleSql(migrations).trimEnd().split("\n");
    assert.deepEqual(lines, [
      "CREATE TABLE users (id INTEGER);",
      "CREATE TABLE b (id INTEGER);",
      "CREATE INDEX i ON b(id);",
      "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);",
      "INSERT INTO d1_migrations (name) VALUES ('0001_init.sql');",
      "INSERT INTO d1_migrations (name) VALUES ('0002_more.sql');",
    ]);
    assert.ok(lines.every((line) => !line.includes("--")));
  });

  it("文件名不合规或没有语句时失败", () => {
    assert.throws(() => buildConsoleSql([{ name: "x'.sql", sql: "SELECT 1;" }]), /文件名不合规/);
    assert.throws(() => buildConsoleSql([{ name: "0003_empty.sql", sql: "-- 只有注释\n" }]), /没有任何语句/);
  });

  it("仓库里的真实迁移都能改写，且没有跨行字符串", () => {
    const real = readMigrations(join(import.meta.dirname, "../migrations"));
    const sql = buildConsoleSql(real);
    assert.ok(sql.startsWith("CREATE TABLE users "), "第一句必须是 CREATE TABLE users（误粘到 temp_email 库时立即失败）");
    for (const { name } of real) assert.ok(sql.includes(`VALUES ('${name}');`), name);
  });
});

describe("buildSingleMigrationSql", () => {
  it("首句是只能在 APP_DB 上通过的探测语句，其后是迁移语句与自己的记录", () => {
    const lines = buildSingleMigrationSql({ name: "0002_more.sql", sql: "-- x\nCREATE TABLE b (id INTEGER);\n" })
      .trimEnd()
      .split("\n");
    assert.equal(lines[0], APP_DB_PROBE);
    assert.equal(lines[1], "CREATE TABLE b (id INTEGER);");
    assert.equal(lines.at(-1), "INSERT INTO d1_migrations (name) VALUES ('0002_more.sql');");
    assert.ok(lines.every((line) => !line.includes("--")));
  });

  it("首句已是 CREATE TABLE users 的 0001 不加探测（全新库上要能单独执行）", () => {
    const sql = buildSingleMigrationSql({ name: "0001_init.sql", sql: "CREATE TABLE users (username_lc TEXT);\n" });
    assert.ok(sql.startsWith("CREATE TABLE users (username_lc TEXT);\n"));
  });

  it("探测的列由 0001 建在 users 表上", () => {
    const [first] = readMigrations(migrationsPath);
    assert.ok(first !== undefined);
    const create = (first.sql.match(/CREATE TABLE users \(([\s\S]*?)\n\);/) ?? [])[1] ?? "";
    assert.match(create, /\busername_lc\b/);
    assert.equal(APP_DB_PROBE, "SELECT username_lc FROM users LIMIT 0;");
  });

  it("仓库里每个单独迁移文件的首句都是探测语句（0001 除外，首句是 CREATE TABLE users）", () => {
    for (const migration of readMigrations(migrationsPath)) {
      const first = buildSingleMigrationSql(migration).split("\n")[0];
      if (migration.name.startsWith("0001_")) assert.ok(first?.startsWith("CREATE TABLE users "), migration.name);
      else assert.equal(first, APP_DB_PROBE, migration.name);
    }
  });

  it("app-db-init.sql 不含探测语句，首句是 CREATE TABLE users", () => {
    const sql = buildConsoleSql(readMigrations(migrationsPath));
    assert.ok(!sql.includes(APP_DB_PROBE));
    assert.ok(sql.startsWith("CREATE TABLE users "));
  });
});
