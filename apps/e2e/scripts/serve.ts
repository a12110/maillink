// 端到端测试的服务端：每次运行都用全新的临时数据目录，依次构建前端 → 迁移 APP_DB → 灌 MAIL_DB 种子 → 起 wrangler dev。
// 由 Playwright 的 webServer 启动（见 playwright.config.ts），收到 SIGTERM 时停掉 wrangler 并删除临时目录。
// 只用本地模式，永远不带 --remote；不读取也不覆盖 apps/worker/.dev.vars（密钥经 --env-file 传入）。
// 环境变量：TEMP_EMAIL_SCHEMA（必填，cloudflare_temp_email 的 db/schema.sql）；E2E_KEEP_DATA=1 保留临时目录便于排查。

import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { APP_SECRET, E2E_PORT, ORIGIN, SETUP_TOKEN } from "../support/env.ts";

const LOG_TAIL_LINES = 40;
const STOP_TIMEOUT_MS = 8000;

const e2eDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(e2eDir, "../..");
const workerDir = join(repoRoot, "apps/worker");
const wranglerBin = join(workerDir, "node_modules/.bin/wrangler");
const hookPath = join(e2eDir, "scripts/persist-to-hook.ts");

function requireSchemaPath(): string {
  const schema = process.env["TEMP_EMAIL_SCHEMA"];
  if (!schema) {
    throw new Error("未设置 TEMP_EMAIL_SCHEMA：请指向 cloudflare_temp_email 的 db/schema.sql（本机：/Users/a12110/Code/TS/cloudflare_temp_email/db/schema.sql）。");
  }
  if (!existsSync(schema)) throw new Error(`TEMP_EMAIL_SCHEMA 指向的文件不存在：${schema}`);
  return schema;
}

function logTail(logFile: string): string {
  return readFileSync(logFile, "utf8").split("\n").slice(-LOG_TAIL_LINES).join("\n");
}

/** 一步准备工作：输出进日志文件，失败时抛出带日志尾部的错误 */
function step(label: string, logFile: string, command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): void {
  console.log(`[e2e] ${label}`);
  const fd = openSync(logFile, "a");
  try {
    execFileSync(command, args, { ...options, stdio: ["ignore", fd, fd] });
  } catch {
    throw new Error(`${label} 失败，日志尾部：\n${logTail(logFile)}`);
  } finally {
    closeSync(fd);
  }
}

function prepare(dataDir: string, schemaPath: string, logFile: string): void {
  step("构建前端（pnpm --filter web build）", logFile, "pnpm", ["--filter", "web", "build"], { cwd: repoRoot });
  // 只迁移 APP_DB；MAIL_DB 由种子脚本建表
  step("迁移 APP_DB", logFile, wranglerBin, ["d1", "migrations", "apply", "APP_DB", "--local", "--persist-to", dataDir], { cwd: workerDir });
  step("灌 MAIL_DB 种子", logFile, process.execPath, ["--import", hookPath, join(workerDir, "scripts/seed-mail-db.ts")], {
    cwd: workerDir,
    env: { ...process.env, E2E_PERSIST_TO: dataDir, TEMP_EMAIL_SCHEMA: schemaPath },
  });
}

function startWrangler(dataDir: string, logFile: string) {
  // 密钥与来源只走 --env-file：传了 --env-file 后 wrangler 不再读取 apps/worker/.dev.vars（否则 .dev.vars 会盖过 --var）
  const envFile = join(dataDir, "e2e.env");
  writeFileSync(envFile, `APP_SECRET=${APP_SECRET}\nSETUP_TOKEN=${SETUP_TOKEN}\nPUBLIC_ORIGIN=${ORIGIN}\n`, "utf8");
  const fd = openSync(logFile, "a");
  const args = ["dev", "--port", String(E2E_PORT), "--persist-to", dataDir, "--env-file", envFile, "--var", `PUBLIC_ORIGIN:${ORIGIN}`];
  const child = spawn(wranglerBin, args, {
    cwd: workerDir,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" },
  });
  closeSync(fd);
  return child;
}

function main(): void {
  const schemaPath = requireSchemaPath();
  const dataDir = mkdtempSync(join(tmpdir(), "maillink-e2e-"));
  const logFile = join(dataDir, "server.log");
  writeFileSync(logFile, "");
  console.log(`[e2e] 临时数据目录：${dataDir}`);

  const cleanup = () => {
    if (process.env["E2E_KEEP_DATA"] === "1") console.log(`[e2e] 已保留 ${dataDir}`);
    else rmSync(dataDir, { recursive: true, force: true });
  };
  try {
    prepare(dataDir, schemaPath, logFile);
  } catch (error) {
    console.error(`[e2e] ${error instanceof Error ? error.message : String(error)}`);
    cleanup();
    process.exit(1);
  }

  console.log(`[e2e] 启动 wrangler dev（${ORIGIN}）`);
  const child = startWrangler(dataDir, logFile);
  let stopping = false;
  child.on("exit", (code, signal) => {
    if (!stopping) console.error(`[e2e] wrangler 意外退出（code=${code} signal=${signal}），日志尾部：\n${logTail(logFile)}`);
    cleanup();
    process.exit(stopping ? 0 : 1);
  });
  const stop = () => {
    stopping = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

try {
  main();
} catch (error) {
  console.error(`[e2e] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
