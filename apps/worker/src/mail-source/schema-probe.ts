import type { MailSchemaProbe } from "@maillink/shared";

// MAIL_DB 表结构探测，契约见 docs/design/01-architecture-and-data.md §3.1。
// 本目录只允许读：不得出现写入或改结构的 SQL，由 test/mail-source-readonly.test.ts 守卫。

/** raw_mails 的必需列：任一缺失即不健康 */
export const REQUIRED_RAW_MAILS_COLUMNS = ["id", "source", "address", "raw", "created_at"] as const;

/** temp_email 保存 db_version 的 settings 键 */
export const DB_VERSION_KEY = "db_version";

const WARNING_NO_TO_ADDRESS =
  "raw_mails 缺少 to_address 列：只能按 address 匹配，iCloud 别名邮件将匹配不到";
const WARNING_NO_DB_VERSION = "无法读取 settings.db_version（settings 表或该键不存在）";

type TableInfoRow = { name: string };

async function listColumns(db: D1Database, table: "raw_mails" | "settings"): Promise<string[]> {
  // table 取值被类型限定为两个字面量，PRAGMA 不支持参数绑定
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<TableInfoRow>();
  return results.map((row) => row.name);
}

async function readDbVersion(db: D1Database): Promise<string | null> {
  const settingsColumns = await listColumns(db, "settings");
  if (settingsColumns.length === 0) return null;
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?1")
    .bind(DB_VERSION_KEY)
    .first<{ value: string | null }>();
  return row?.value ?? null;
}

/**
 * 实时探测 MAIL_DB，不读缓存。
 * 查询本身失败（绑定缺失、D1 故障）时直接抛出，由调用方决定如何呈现。
 */
export async function probeMailSchema(db: D1Database): Promise<MailSchemaProbe> {
  const columns = await listColumns(db, "raw_mails");
  const present = new Set(columns);
  const tableExists = columns.length > 0;
  const missingRequired = REQUIRED_RAW_MAILS_COLUMNS.filter((name) => !present.has(name));
  const dbVersion = await readDbVersion(db);

  const warnings: string[] = [];
  if (tableExists && !present.has("to_address")) warnings.push(WARNING_NO_TO_ADDRESS);
  if (dbVersion === null) warnings.push(WARNING_NO_DB_VERSION);

  return {
    healthy: tableExists && missingRequired.length === 0,
    table_exists: tableExists,
    columns,
    // 表不存在时所有必需列都算缺失
    missing_required: [...missingRequired],
    capabilities: {
      to_address: present.has("to_address"),
      raw_blob: present.has("raw_blob"),
      metadata: present.has("metadata"),
    },
    db_version: dbVersion,
    warnings,
  };
}

// isolate 内缓存。只缓存健康结果：不健康时每次重探，修复表结构后无需重启 isolate
let cachedProbe: MailSchemaProbe | null = null;

export function resetMailSchemaCache(): void {
  cachedProbe = null;
}

/** 带缓存的探测；`refresh: true` 强制重探并更新缓存（健康检查接口使用） */
export async function getMailSchema(
  db: D1Database,
  options: { refresh?: boolean } = {},
): Promise<MailSchemaProbe> {
  if (cachedProbe && !options.refresh) return cachedProbe;
  // 强制重探时先作废旧缓存：重探抛异常后不能留着可能已过期的"健康"结果
  if (options.refresh) cachedProbe = null;
  const probe = await probeMailSchema(db);
  cachedProbe = probe.healthy ? probe : null;
  return probe;
}
