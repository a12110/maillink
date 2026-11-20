// 生成控制台（GUI）部署用的产物，见 docs/deploy-gui.md：
// - dist/single/worker.js：前端打进 bundle 的单文件 Worker，在控制台"编辑代码"里上传；
// - dist/single/sql/app-db-init.sql：APP_DB 全部迁移，粘贴到 D1 控制台执行一次；
// - dist/single/sql/<迁移文件名>：单个迁移，升级时只执行新增的那几个。
// 用法（仓库根目录，先 pnpm --filter web build）：pnpm --filter worker build:single
// 打包用仓库里的 wrangler（deploy --dry-run，只在本地打包，不连接 Cloudflare），兼容日期等配置沿用 wrangler.jsonc。

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import type {
  EmbeddedAsset,
  EmbeddedAssetManifest,
  EmbeddedHeaderRule,
} from "../src/embedded-assets-manifest.ts";

const workerDir = resolve(fileURLToPath(import.meta.url), "../..");
const webDistDir = resolve(workerDir, "../web/dist");
const migrationsDir = join(workerDir, "migrations");
const outDir = join(workerDir, "dist/single");
const wranglerBin = join(workerDir, "node_modules/.bin/wrangler");

const SPA_FALLBACK = "/index.html";
const HEADERS_FILE = "_headers";
/** Workers Static Assets 的特殊文件：_headers 已转成规则；_redirects 单文件模式不支持，出现即失败 */
const UNSUPPORTED_SPECIAL_FILES = new Set(["_redirects"]);
const BYTES_PER_KIB = 1024;

/** 文本按 utf8 存，其余按 base64 存；扩展名不在表里直接失败，避免以错误类型下发 */
const CONTENT_TYPES: Record<string, { type: string; text: boolean }> = {
  ".html": { type: "text/html; charset=utf-8", text: true },
  ".js": { type: "text/javascript; charset=utf-8", text: true },
  ".mjs": { type: "text/javascript; charset=utf-8", text: true },
  ".css": { type: "text/css; charset=utf-8", text: true },
  ".json": { type: "application/json; charset=utf-8", text: true },
  ".webmanifest": { type: "application/manifest+json; charset=utf-8", text: true },
  ".svg": { type: "image/svg+xml; charset=utf-8", text: true },
  ".txt": { type: "text/plain; charset=utf-8", text: true },
  ".png": { type: "image/png", text: false },
  ".jpg": { type: "image/jpeg", text: false },
  ".jpeg": { type: "image/jpeg", text: false },
  ".gif": { type: "image/gif", text: false },
  ".webp": { type: "image/webp", text: false },
  ".ico": { type: "image/x-icon", text: false },
  ".woff": { type: "font/woff", text: false },
  ".woff2": { type: "font/woff2", text: false },
};

/** 请求路径只允许不需要百分号编码的字符，内嵌后按原样精确匹配 */
const ASSET_PATH_PATTERN = /^\/[A-Za-z0-9._\-/]+$/;
/** _headers 的路径：精确路径，或以 "/*" 结尾的前缀匹配；不支持占位符与中间的 * */
const HEADER_PATTERN = /^\/(?:[A-Za-z0-9._-]+\/)*(?:[A-Za-z0-9._-]+|\*)?$/;
const HEADER_LINE = /^\s+([A-Za-z0-9-]+):\s*(.*)$/;
/** wrangler 记录迁移用的表，与 `wrangler d1 migrations apply` 一致，之后换回命令行也能接着用 */
const MIGRATIONS_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);";
const MIGRATION_NAME = /^[0-9]{4}_[a-z0-9_]+\.sql$/;

export type Migration = { name: string; sql: string };

export function assetFor(path: string, bytes: Buffer): EmbeddedAsset {
  const kind = CONTENT_TYPES[extname(path).toLowerCase()];
  if (kind === undefined) throw new Error(`不认识的前端文件类型：${path}（在 CONTENT_TYPES 里补上 MIME 类型）`);
  if (kind.text) return { contentType: kind.type, encoding: "utf8", body: bytes.toString("utf8") };
  return { contentType: kind.type, encoding: "base64", body: bytes.toString("base64") };
}

function parseHeaderLine(rules: EmbeddedHeaderRule[], line: string, where: string): void {
  if (!/^\s/.test(line)) {
    if (!HEADER_PATTERN.test(line)) throw new Error(`${where}：不支持的路径写法 ${JSON.stringify(line)}`);
    rules.push({ pattern: line, headers: [] });
    return;
  }
  const match = HEADER_LINE.exec(line);
  const rule = rules.at(-1);
  // "! Name"（去掉上层规则的头）等写法也会落到这里
  if (match === null || rule === undefined) throw new Error(`${where}：不支持的写法 ${JSON.stringify(line.trim())}`);
  rule.headers.push([match[1] as string, (match[2] as string).trim()]);
}

/** 解析构建生成的 _headers（格式见 apps/web/scripts/gen-headers.mjs），遇到不支持的写法直接失败 */
export function parseHeadersFile(text: string): EmbeddedHeaderRule[] {
  const rules: EmbeddedHeaderRule[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    parseHeaderLine(rules, line, `_headers 第 ${index + 1} 行`);
  }
  const empty = rules.find((rule) => rule.headers.length === 0);
  if (empty !== undefined) throw new Error(`_headers 路径 ${empty.pattern} 下没有任何响应头`);
  return rules;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

/** 读前端 dist 生成内嵌清单；_headers 转成规则，不作为文件下发 */
export function buildAssetManifest(distDir: string): EmbeddedAssetManifest {
  const headersPath = join(distDir, HEADERS_FILE);
  if (!existsSync(join(distDir, "index.html"))) throw new Error(`找不到 ${distDir}/index.html：先运行 pnpm --filter web build`);
  if (!existsSync(headersPath)) throw new Error(`找不到 ${headersPath}：web 构建的 gen-headers 没有执行`);
  const files: Record<string, EmbeddedAsset> = {};
  for (const full of listFiles(distDir)) {
    const path = `/${relative(distDir, full).split(sep).join("/")}`;
    const name = path.slice(1);
    if (name === HEADERS_FILE) continue;
    if (UNSUPPORTED_SPECIAL_FILES.has(name)) throw new Error(`单文件模式不支持 ${name}`);
    if (!ASSET_PATH_PATTERN.test(path)) throw new Error(`前端文件路径含需要编码的字符：${path}`);
    files[path] = assetFor(path, readFileSync(full));
  }
  return { files, headerRules: parseHeadersFile(readFileSync(headersPath, "utf8")), spaFallback: SPA_FALLBACK };
}

/** 引号内的字符串与标识符、注释、分号、空白、其余片段；sticky 匹配不上说明有未闭合的引号 */
const SQL_TOKEN = /'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\/|;|\s+|[^'"\s;/-]+|[/-]/y;
/** 注释与空白都只起分隔作用 */
const SQL_SEPARATOR = /^(?:\s|--|\/\*)/;

function tokenizeSql(sql: string, label: string): string[] {
  const tokens: string[] = [];
  SQL_TOKEN.lastIndex = 0;
  while (SQL_TOKEN.lastIndex < sql.length) {
    const at = SQL_TOKEN.lastIndex;
    const match = SQL_TOKEN.exec(sql);
    if (match === null) throw new Error(`${label}：第 ${at} 个字符处有未闭合的引号`);
    const token = match[0];
    if (/^['"]/.test(token) && token.includes("\n")) throw new Error(`${label}：字符串跨行，D1 控制台粘贴时会丢掉换行`);
    tokens.push(token);
  }
  return tokens;
}

/**
 * 把迁移 SQL 改写成 D1 控制台能执行的形式：控制台是单行输入框，粘贴时换行会被吞掉，"--" 注释会把后面的语句全部注释掉。
 * 所以去掉注释、语句内的空白压成一个空格、每条语句独占一行（换行被吞后仍以分号分隔）。字符串字面量原样保留，跨行的直接失败。
 */
export function toConsoleStatements(sql: string, label: string): string[] {
  const statements: string[] = [];
  let parts: string[] = [];
  let pendingSpace = false;
  for (const token of tokenizeSql(sql, label)) {
    if (token === ";") {
      if (parts.length > 0) statements.push(`${parts.join("")};`);
      parts = [];
      pendingSpace = false;
    } else if (SQL_SEPARATOR.test(token)) {
      pendingSpace = parts.length > 0;
    } else {
      parts.push(pendingSpace ? ` ${token}` : token);
      pendingSpace = false;
    }
  }
  if (parts.length > 0) throw new Error(`${label}：最后一条语句缺少分号`);
  return statements;
}

/** 迁移语句在前，迁移记录表在最后：误粘到 temp_email 的库时第一句 CREATE TABLE users 就会失败，不会先建出别的表 */
export function buildConsoleSql(migrations: Migration[]): string {
  const lines: string[] = [];
  for (const { name, sql } of migrations) {
    if (!MIGRATION_NAME.test(name)) throw new Error(`迁移文件名不合规：${name}`);
    const statements = toConsoleStatements(sql, name);
    if (statements.length === 0) throw new Error(`${name} 里没有任何语句`);
    lines.push(...statements);
  }
  lines.push(MIGRATIONS_TABLE_DDL);
  for (const { name } of migrations) lines.push(`INSERT INTO d1_migrations (name) VALUES ('${name}');`);
  return `${lines.join("\n")}\n`;
}

export function readMigrations(dir: string): Migration[] {
  const names = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  if (names.length === 0) throw new Error(`${dir} 里没有迁移文件`);
  return names.map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

function writeEntry(manifest: EmbeddedAssetManifest): string {
  const entryPath = join(outDir, "entry.mjs");
  const source = [
    'import worker from "../../src/index.ts";',
    'import { withEmbeddedAssets } from "../../src/embedded-assets.ts";',
    `export default withEmbeddedAssets(worker, ${JSON.stringify(manifest)});`,
    "",
  ].join("\n");
  writeFileSync(entryPath, source);
  return entryPath;
}

function bundle(entryPath: string): string {
  const bundleDir = join(outDir, "bundle");
  execFileSync(wranglerBin, ["deploy", entryPath, "--dry-run", "--outdir", bundleDir], { cwd: workerDir, stdio: "inherit" });
  const outputs = readdirSync(bundleDir).filter((name) => name.endsWith(".js"));
  if (outputs.length !== 1) throw new Error(`期望 wrangler 只输出一个 .js，实际：${outputs.join(", ") || "无"}`);
  return join(bundleDir, outputs[0] as string);
}

function writeSql(migrations: Migration[]): void {
  const sqlDir = join(outDir, "sql");
  mkdirSync(sqlDir, { recursive: true });
  writeFileSync(join(sqlDir, "app-db-init.sql"), buildConsoleSql(migrations));
  for (const migration of migrations) writeFileSync(join(sqlDir, migration.name), buildConsoleSql([migration]));
}

function main(): void {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const manifest = buildAssetManifest(webDistDir);
  const workerJs = readFileSync(bundle(writeEntry(manifest)));
  writeFileSync(join(outDir, "worker.js"), workerJs);
  const migrations = readMigrations(migrationsDir);
  writeSql(migrations);
  const kib = (bytes: number): string => `${(bytes / BYTES_PER_KIB).toFixed(1)} KiB`;
  process.stdout.write(
    [
      `已生成 ${join(outDir, "worker.js")}（${kib(workerJs.length)}，gzip ${kib(gzipSync(workerJs).length)}，内嵌前端文件 ${Object.keys(manifest.files).length} 个）`,
      `已生成 ${join(outDir, "sql")}/app-db-init.sql 与 ${migrations.length} 个单独迁移`,
      "",
    ].join("\n"),
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
