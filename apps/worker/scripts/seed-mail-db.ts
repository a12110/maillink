// 本地种子脚本：用 cloudflare_temp_email 的 db/schema.sql 在【本地】MAIL_DB 建表，并灌入合成邮件。
// 这是仓库里唯一允许写 MAIL_DB 的地方（且只写本地 miniflare 存储，永远不带 --remote）。
// 用法（在仓库根目录）：pnpm --filter worker db:seed-mail
// 环境变量：TEMP_EMAIL_SCHEMA 覆盖 schema.sql 路径，默认取与本仓库同级的 cloudflare_temp_email。

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { formatD1Utc } from "../src/mail-source/time.ts";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(workerDir, "../..");
const fixturesDir = join(workerDir, "test/fixtures");
const wranglerBin = join(workerDir, "node_modules/.bin/wrangler");
const schemaPath =
  process.env["TEMP_EMAIL_SCHEMA"] ?? resolve(repoRoot, "../cloudflare_temp_email/db/schema.sql");

/** temp_email 当前的 DB_VERSION（worker/src/constants.ts） */
const MAIL_DB_VERSION = "v0.0.11";
const MS_PER_MINUTE = 60_000;

type SeedMail = {
  id: number;
  file: string;
  /** SMTP 信封发件人（raw_mails.source） */
  source: string;
  /** SMTP 信封收件人（raw_mails.address），转发链的最后一跳 */
  address: string;
  /** 邮件头里的真实收件人（raw_mails.to_address）；iCloud 邮件填别名 */
  toAddress: string;
  /** 距现在多少分钟前入库 */
  ageMinutes: number;
  /** true：gzip 后放 raw_blob，raw 为空（模拟 ENABLE_MAIL_GZIP） */
  gzip: boolean;
};

const MAILS: SeedMail[] = [
  {
    id: 1,
    file: "icloud-hme-forward.eml",
    source: "bounce+hme@example.net",
    address: "mailbox@example.com",
    toAddress: "hme.alias.7k2@icloud.com",
    ageMinutes: 50,
    gzip: false,
  },
  {
    id: 2,
    file: "verification-code.eml",
    source: "noreply@login.example.org",
    address: "plain.user@example.com",
    toAddress: "plain.user@example.com",
    ageMinutes: 40,
    gzip: false,
  },
  {
    id: 3,
    file: "password-reset.eml",
    source: "support@service.example.com",
    address: "plain.user@example.com",
    toAddress: "plain.user@example.com",
    ageMinutes: 30,
    gzip: false,
  },
  {
    id: 4,
    file: "html-newsletter.eml",
    source: "news@newsletter.example.com",
    address: "plain.user@example.com",
    toAddress: "plain.user@example.com",
    ageMinutes: 20,
    gzip: false,
  },
  {
    id: 5,
    file: "gzip-blob.eml",
    source: "alerts@security.example.net",
    address: "plain.user@example.com",
    toAddress: "plain.user@example.com",
    ageMinutes: 10,
    gzip: true,
  },
];

const sqlText = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/** 真实邮件的行尾是 CRLF，fixture 文件用 LF 便于编辑，入库前统一转换 */
const toCrlf = (text: string): string => text.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");

function buildInsert(mail: SeedMail, nowMs: number): string {
  const raw = toCrlf(readFileSync(join(fixturesDir, mail.file), "utf8"));
  const createdAt = formatD1Utc(nowMs - mail.ageMinutes * MS_PER_MINUTE);
  const rawValue = mail.gzip ? "NULL" : sqlText(raw);
  const blobValue = mail.gzip ? `X'${gzipSync(Buffer.from(raw, "utf8")).toString("hex")}'` : "NULL";
  const messageId = /^Message-ID:\s*(.+)$/im.exec(raw)?.[1]?.trim();
  if (!messageId) throw new Error(`${mail.file} 缺少 Message-ID 头`);
  return (
    "INSERT INTO raw_mails (id, message_id, source, address, to_address, raw, raw_blob, is_unread, created_at) VALUES (" +
    [
      mail.id,
      sqlText(messageId),
      sqlText(mail.source),
      sqlText(mail.address),
      sqlText(mail.toAddress),
      rawValue,
      blobValue,
      1,
      sqlText(createdAt),
    ].join(", ") +
    ");"
  );
}

function main(): void {
  if (!existsSync(schemaPath)) {
    throw new Error(`找不到 temp_email 的 schema.sql: ${schemaPath}（可用 TEMP_EMAIL_SCHEMA 指定）`);
  }
  const nowMs = Date.now();
  const statements = [
    readFileSync(schemaPath, "utf8"),
    // 可重复执行：清掉上一次的种子行再重灌
    "DELETE FROM raw_mails;",
    "DELETE FROM settings WHERE key = 'db_version';",
    `INSERT INTO settings (key, value) VALUES ('db_version', ${sqlText(MAIL_DB_VERSION)});`,
    ...MAILS.map((mail) => buildInsert(mail, nowMs)),
  ];

  const tempDir = mkdtempSync(join(tmpdir(), "maillink-seed-"));
  const sqlFile = join(tempDir, "seed-mail-db.sql");
  try {
    writeFileSync(sqlFile, statements.join("\n"), "utf8");
    // 只用 --local：永远不触碰 Cloudflare 上的库
    execFileSync(wranglerBin, ["d1", "execute", "MAIL_DB", "--local", "--file", sqlFile], {
      cwd: workerDir,
      stdio: "inherit",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  console.log(`已写入本地 MAIL_DB：${MAILS.length} 封合成邮件`);
}

main();
