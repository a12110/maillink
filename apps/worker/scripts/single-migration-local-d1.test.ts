// 单个迁移 SQL 的首句探测在本地 D1（wrangler d1 execute --local，miniflare）上的实测，只用 --persist-to 指向的临时目录，不连接 Cloudflare：
// - temp_email 结构的库上，探测语句报 no such column，单个迁移文件与 app-db-init.sql 都失败，库里不多出任何表；
// - 已迁移到前一版的 APP_DB 上，单个迁移文件执行成功。
// 注意 wrangler 的 --file 整体是一个事务，"没建出表"本身不能证明首句就失败，所以另外单独执行首句（--command）看报错。

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { APP_DB_PROBE, buildConsoleSql, buildSingleMigrationSql, readMigrations } from "./build-single-worker.ts";

const workerDir = resolve(import.meta.dirname, "..");
const wranglerBin = join(workerDir, "node_modules/.bin/wrangler");
const migrations = readMigrations(join(workerDir, "migrations"));
const latest = migrations.at(-1);
const previous = migrations.slice(0, -1);

/** 与 cloudflare_temp_email 的 db/schema.sql 里同名表的结构一致（只取与本测试相关的部分） */
const TEMP_EMAIL_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, user_email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, user_info TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);",
  "CREATE TABLE IF NOT EXISTS raw_mails (id INTEGER PRIMARY KEY, source TEXT, address TEXT, raw TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);",
].join("\n");

type Run = { ok: boolean; output: string };

let tmp = "";

function path(name: string): string {
  return join(tmp, name);
}

function wrangler(binding: string, persistDir: string, mode: "--file" | "--command", value: string): Run {
  const result = spawnSync(
    wranglerBin,
    ["d1", "execute", binding, "--local", "--persist-to", persistDir, mode, value, "--json"],
    {
      cwd: workerDir,
      encoding: "utf8",
      env: { ...process.env, WRANGLER_LOG_PATH: path("logs"), WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" },
    },
  );
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

function execFile(binding: string, persistDir: string, name: string, sql: string): Run {
  writeFileSync(path(name), sql);
  return wrangler(binding, persistDir, "--file", path(name));
}

function tables(binding: string, persistDir: string): string[] {
  const run = wrangler(binding, persistDir, "--command", "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name");
  assert.ok(run.ok, run.output);
  const rows = (JSON.parse(run.output.slice(run.output.indexOf("["))) as Array<{ results: Array<{ name: string }> }>)[0];
  return (rows?.results ?? []).map((row) => row.name);
}

before(() => {
  tmp = mkdtempSync(join(tmpdir(), "single-migration-d1-"));
});
after(() => rmSync(tmp, { recursive: true, force: true }));

describe("单个迁移文件的首句探测（本地 D1）", () => {
  assert.ok(latest !== undefined);

  it("temp_email 结构的库：首句探测报 no such column，单个迁移与初始化 SQL 都失败，库里不多出任何表", () => {
    const persist = path("mail-db");
    const setup = execFile("MAIL_DB", persist, "temp-email-schema.sql", TEMP_EMAIL_SCHEMA);
    assert.ok(setup.ok, setup.output);
    const before = tables("MAIL_DB", persist);
    assert.deepEqual(before, ["raw_mails", "users"]);

    const probe = wrangler("MAIL_DB", persist, "--command", APP_DB_PROBE);
    assert.ok(!probe.ok);
    assert.match(probe.output, /no such column: username_lc/);

    const single = execFile("MAIL_DB", persist, "single.sql", buildSingleMigrationSql(latest));
    assert.ok(!single.ok);
    assert.match(single.output, /no such column: username_lc/);
    assert.deepEqual(tables("MAIL_DB", persist), before);

    const init = execFile("MAIL_DB", persist, "init.sql", buildConsoleSql(migrations));
    assert.ok(!init.ok);
    assert.match(init.output, /table users already exists/);
    assert.deepEqual(tables("MAIL_DB", persist), before);
  });

  it("已迁移到前一版的 APP_DB：探测通过，单个迁移文件执行成功并记录自己", () => {
    const persist = path("app-db");
    const prior = execFile("APP_DB", persist, "prior.sql", buildConsoleSql(previous));
    assert.ok(prior.ok, prior.output);

    const probe = wrangler("APP_DB", persist, "--command", APP_DB_PROBE);
    assert.ok(probe.ok, probe.output);

    const single = execFile("APP_DB", persist, "latest.sql", buildSingleMigrationSql(latest));
    assert.ok(single.ok, single.output);
    const names = wrangler("APP_DB", persist, "--command", "SELECT name FROM d1_migrations ORDER BY id");
    assert.ok(names.ok, names.output);
    assert.ok(names.output.includes(latest.name), names.output);
    assert.ok(tables("APP_DB", persist).includes("link_password_inflight"));
  });
});
