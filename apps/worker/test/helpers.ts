import { env } from "cloudflare:workers";
import { resetMailSchemaCache } from "../src/mail-source";

// 测试里需要的 MAIL_DB 表结构。测试是允许写本地 MAIL_DB 的（与种子脚本同理），src/mail-source 不是。
// 列定义取自 cloudflare_temp_email 的 db/schema.sql。

const RAW_MAILS_FULL_COLUMNS = [
  "id INTEGER PRIMARY KEY",
  "message_id TEXT",
  "source TEXT",
  "address TEXT",
  "to_address TEXT",
  "raw TEXT",
  "raw_blob BLOB",
  "metadata TEXT",
  "is_unread INTEGER",
  "created_at DATETIME DEFAULT CURRENT_TIMESTAMP",
];

const SETTINGS_DDL =
  "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)";

export type MailDbShape = {
  /** 需要从完整列集合里去掉的列 */
  omitColumns?: string[];
  /** false 时不建 raw_mails 表 */
  rawMails?: boolean;
  /** settings.db_version；null 表示不写这一行 */
  dbVersion?: string | null;
};

/** 把 MAIL_DB 重建为指定形态（并清掉 isolate 内的探测缓存） */
export async function setupMailDb(shape: MailDbShape = {}): Promise<void> {
  const { omitColumns = [], rawMails = true, dbVersion = "v0.0.11" } = shape;
  const db = env.MAIL_DB;
  await db.batch([
    db.prepare("DROP TABLE IF EXISTS raw_mails"),
    db.prepare("DROP TABLE IF EXISTS settings"),
  ]);
  if (rawMails) {
    const columns = RAW_MAILS_FULL_COLUMNS.filter(
      (definition) => !omitColumns.includes(definition.split(" ")[0] ?? ""),
    );
    await db.prepare(`CREATE TABLE raw_mails (${columns.join(", ")})`).run();
  }
  await db.prepare(SETTINGS_DDL).run();
  if (dbVersion !== null) {
    await db.prepare("INSERT INTO settings (key, value) VALUES ('db_version', ?1)").bind(dbVersion).run();
  }
  resetMailSchemaCache();
}
