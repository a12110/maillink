import type { MailSchemaProbe } from "@maillink/shared";
import { nowSec } from "../clock";
import { MAIL_SCHEMA_DEGRADED_CACHE_TTL_SEC } from "../constants";

// MAIL_DB 表结构探测，契约见 docs/design/01-architecture-and-data.md §3.1。
// 本目录只允许读：不得出现写入或改结构的 SQL，由 test/mail-source-readonly.test.ts 守卫。

/** raw_mails 的必需列：任一缺失即不健康 */
export const REQUIRED_RAW_MAILS_COLUMNS = ["id", "source", "address", "raw", "created_at"] as const;

/** temp_email 保存 db_version 的 settings 键 */
export const DB_VERSION_KEY = "db_version";

// 口径与前端 apps/web/src/features/mail-db/notice-text.ts 一致（测试分别断言关键词）
export const WARNING_NO_TO_ADDRESS =
  "raw_mails 缺少 to_address 列：不支持 iCloud 隐私邮箱（Hide My Email），以 iCloud 别名作为收件地址时收不到邮件，其他收件地址不受影响。" +
  "请升级 temp_email 到包含 db/2026-08-02-to-address.sql 迁移的修改版（v1.15.0 起）并执行该迁移";
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

// isolate 内缓存：
// - 完全兼容（healthy 且有 to_address）：缓存到 isolate 结束；
// - healthy 但缺 to_address：只缓存 MAIL_SCHEMA_DEGRADED_CACHE_TTL_SEC 秒，过期重探，
//   这样管理员执行 to_address 迁移后各 isolate 无需重启即可在 TTL 内按新结构查询；
// - 不健康：不缓存，每次重探。
type CachedProbe = { probe: MailSchemaProbe; expiresAt: number | null };
let cached: CachedProbe | null = null;

export function resetMailSchemaCache(): void {
  cached = null;
}

function cacheEntry(probe: MailSchemaProbe): CachedProbe | null {
  if (!probe.healthy) return null;
  return { probe, expiresAt: probe.capabilities.to_address ? null : nowSec() + MAIL_SCHEMA_DEGRADED_CACHE_TTL_SEC };
}

/** 带缓存的探测；`refresh: true` 强制重探并更新缓存（健康检查接口使用） */
export async function getMailSchema(
  db: D1Database,
  options: { refresh?: boolean } = {},
): Promise<MailSchemaProbe> {
  if (cached && !options.refresh && (cached.expiresAt === null || nowSec() < cached.expiresAt)) return cached.probe;
  // 强制重探或缓存过期时先作废旧缓存：重探抛异常后不能留着可能已过期的结果
  cached = null;
  const probe = await probeMailSchema(db);
  cached = cacheEntry(probe);
  return probe;
}
