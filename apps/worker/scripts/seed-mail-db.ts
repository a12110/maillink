// 本地种子脚本：用 cloudflare_temp_email 的 db/schema.sql 在【本地】MAIL_DB 建表，并灌入合成邮件。
// 这是仓库里唯一允许写 MAIL_DB 的地方（且只写本地 miniflare 存储，永远不带 --remote）。
// 用法（在仓库根目录）：pnpm --filter worker db:seed-mail
// 环境变量：TEMP_EMAIL_SCHEMA 覆盖 schema.sql 路径，默认取与本仓库同级的 cloudflare_temp_email；
// PERSIST_TO 指定本地存储目录（给 wrangler 追加 --persist-to，e2e 用来隔离数据），不设置时用 wrangler 的默认目录。

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { buildLargeMail } from "../test/fixtures/build-large-mail.ts";
import { formatD1Utc } from "../src/mail-source/time.ts";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(workerDir, "../..");
const fixturesDir = join(workerDir, "test/fixtures");
const wranglerBin = join(workerDir, "node_modules/.bin/wrangler");
const schemaPath =
  process.env["TEMP_EMAIL_SCHEMA"] ?? resolve(repoRoot, "../cloudflare_temp_email/db/schema.sql");
const persistTo = process.env["PERSIST_TO"];

/** temp_email 当前的 DB_VERSION（worker/src/constants.ts） */
const MAIL_DB_VERSION = "v0.0.11";
const MS_PER_MINUTE = 60_000;

type SeedMail = {
  id: number;
  /** test/fixtures 下的文件名；null 表示原文由 `raw` 字段直接给出 */
  file: string | null;
  /** 不从文件读时的原文（"生成的样本"与"空原文"） */
  raw?: string | null;
  /** 文件里没有 Message-ID 头时显式给出 */
  messageId?: string;
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
  /** raw_mails.metadata：temp_email 的 ai_extract 结果 */
  metadata?: string;
};

const PLAIN = "plain.user@example.com";

function fileMail(
  id: number,
  file: string,
  source: string,
  ageMinutes: number,
  overrides: Partial<SeedMail> = {},
): SeedMail {
  return { id, file, source, address: PLAIN, toAddress: PLAIN, ageMinutes, gzip: false, ...overrides };
}

const MAILS: SeedMail[] = [
  fileMail(1, "icloud-hme-forward.eml", "bounce+hme@example.net", 50, {
    address: "mailbox@example.com",
    toAddress: "hme.alias.7k2@icloud.com",
  }),
  fileMail(2, "verification-code.eml", "noreply@login.example.org", 40),
  fileMail(3, "password-reset.eml", "support@service.example.com", 30),
  fileMail(4, "html-newsletter.eml", "news@newsletter.example.com", 20),
  fileMail(5, "gzip-blob.eml", "alerts@security.example.net", 10, { gzip: true }),
  fileMail(6, "verification-code-zh.eml", "noreply@account.example.cn", 9, {
    address: "zh.user@example.com",
    toAddress: "zh.user@example.com",
  }),
  fileMail(7, "verification-code-ja.eml", "noreply@account.example.jp", 8, {
    address: "ja.user@example.com",
    toAddress: "ja.user@example.com",
  }),
  fileMail(8, "password-reset-code.eml", "noreply@account.example.cn", 7),
  fileMail(9, "email-change.eml", "no-reply@accounts.example.org", 6),
  fileMail(10, "security-notice.eml", "alerts@security.example.org", 5),
  fileMail(11, "billing-receipt.eml", "billing@pay.example.org", 4),
  fileMail(12, "verification-code-spaced.eml", "noreply@login.example.org", 3),
  fileMail(13, "no-code-distractors.eml", "orders@store.example.org", 3),
  { id: 14, file: null, raw: buildLargeMail(), source: "bulk@mailer.example.org", address: PLAIN, toAddress: PLAIN, ageMinutes: 2, gzip: true },
  fileMail(15, "icloud-hme-mismatch.eml", "bounce+hme@example.net", 2, {
    address: "mailbox@example.com",
    toAddress: "hme.alias.7k2@icloud.com",
  }),
  fileMail(16, "ai-extract-priority.eml", "noreply@login.example.org", 1, {
    metadata: JSON.stringify({
      ai_extract: { type: "auth_code", result: "445566", result_text: "synthetic ai_extract result" },
      extracted_at: "2026-11-20T08:50:00.000Z",
    }),
  }),
  fileMail(17, "attachment.eml", "docs@files.example.org", 1),
  fileMail(18, "malformed.eml", "unknown@nowhere.example.org", 1, { messageId: "synthetic-malformed-0018" }),
  fileMail(20, "multiline-text.eml", "notes@docs.example.org", 1),
  fileMail(21, "masked-code.eml", "noreply@login.example.org", 1),
  fileMail(22, "attachment-emoji.eml", "docs@files.example.org", 1),
  // 合成的"原文丢失"：raw 与 raw_blob 都为空
  { id: 19, file: null, raw: null, messageId: "synthetic-empty-0019", source: "gone@nowhere.example.org", address: PLAIN, toAddress: PLAIN, ageMinutes: 1, gzip: false },
];

const sqlText = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/** 真实邮件的行尾是 CRLF，fixture 文件用 LF 便于编辑，入库前统一转换 */
const toCrlf = (text: string): string => text.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");

function readRaw(mail: SeedMail): string | null {
  if (mail.file !== null) return toCrlf(readFileSync(join(fixturesDir, mail.file), "utf8"));
  return mail.raw === undefined || mail.raw === null ? null : toCrlf(mail.raw);
}

function findMessageId(mail: SeedMail, raw: string | null): string {
  const fromHeader = raw === null ? undefined : /^Message-ID:\s*(.+)$/im.exec(raw)?.[1]?.trim();
  const messageId = mail.messageId ?? fromHeader;
  if (!messageId) throw new Error(`${mail.file ?? `id ${mail.id}`} 缺少 Message-ID`);
  return messageId;
}

function buildInsert(mail: SeedMail, nowMs: number): string {
  const raw = readRaw(mail);
  const createdAt = formatD1Utc(nowMs - mail.ageMinutes * MS_PER_MINUTE);
  const gzipped = raw !== null && mail.gzip;
  const rawValue = raw === null || gzipped ? "NULL" : sqlText(raw);
  const blobValue = gzipped ? `X'${gzipSync(Buffer.from(raw, "utf8")).toString("hex")}'` : "NULL";
  const metadataValue = mail.metadata === undefined ? "NULL" : sqlText(mail.metadata);
  return (
    "INSERT INTO raw_mails (id, message_id, source, address, to_address, raw, raw_blob, metadata, is_unread, created_at) VALUES (" +
    [
      mail.id,
      sqlText(findMessageId(mail, raw)),
      sqlText(mail.source),
      sqlText(mail.address),
      sqlText(mail.toAddress),
      rawValue,
      blobValue,
      metadataValue,
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
    const persistArgs = persistTo ? ["--persist-to", persistTo] : [];
    execFileSync(wranglerBin, ["d1", "execute", "MAIL_DB", "--local", "--file", sqlFile, ...persistArgs], {
      cwd: workerDir,
      stdio: "inherit",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  console.log(`已写入本地 MAIL_DB：${MAILS.length} 封合成邮件`);
}

main();
