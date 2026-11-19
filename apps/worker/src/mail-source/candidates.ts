import type { MailCapabilities } from "@maillink/shared";
import { IMPORTED_SCOPE_MAX_ADDRESSES } from "../constants";
import { ApiError } from "../errors";
import { HTTP_BAD_REQUEST, HTTP_UNPROCESSABLE } from "../http-status";
import { expandAddressForms } from "./addresses";
import { requireMailSchema } from "./guard";
import type { AdminMailFilters, MailCandidate } from "./types";
import { formatD1Utc, parseD1Utc } from "./time";

// 候选列表：只取元数据，不取正文（01 §3.2）。所有值都走绑定参数；
// 拼进 SQL 的只有固定片段，是否带 to_address 由 schema 探测的能力标记决定。

const MS_PER_SECOND = 1000;

type CandidateRow = {
  id: number;
  message_id: string | null;
  source: string | null;
  address: string | null;
  to_address: string | null;
  created_at: string;
};

/** 按 `?N` 编号累积绑定参数，同一个参数可以在 SQL 里引用多次（如地址数组） */
class QueryBuilder {
  readonly conditions: string[] = [];
  readonly params: unknown[] = [];

  bind(value: unknown): string {
    this.params.push(value);
    return `?${this.params.length}`;
  }

  where(condition: string): void {
    this.conditions.push(condition);
  }

  whereClause(): string {
    return this.conditions.length > 0 ? `WHERE ${this.conditions.join(" AND ")}` : "";
  }
}

function selectColumns(capabilities: MailCapabilities): string {
  const toAddress = capabilities.to_address ? "to_address" : "NULL AS to_address";
  return `SELECT id, message_id, source, address, ${toAddress}, created_at FROM raw_mails`;
}

/**
 * 01 §3.2 的收件人匹配：to_address 命中，或 to_address 为空时 address 命中。
 * 正向匹配不能再包一层 COALESCE：那会让 SQLite 放弃 OR 的多索引优化，热路径退化成倒序扫全表。
 * 只有取反（unknown 范围）时才需要 COALESCE，见 notRecipientIn。
 */
function recipientIn(placeholder: string, capabilities: MailCapabilities): string {
  const byAddress = `address IN (SELECT value FROM json_each(${placeholder}))`;
  if (!capabilities.to_address) return byAddress;
  const byToAddress = `to_address IN (SELECT value FROM json_each(${placeholder}))`;
  return `(${byToAddress} OR ((to_address IS NULL OR to_address = '') AND ${byAddress}))`;
}

/** 取反：NULL 的取反还是 NULL，会把"地址为空"的行漏掉，所以先 COALESCE 成 0 */
function notRecipientIn(placeholder: string, capabilities: MailCapabilities): string {
  return `NOT COALESCE(${recipientIn(placeholder, capabilities)}, 0)`;
}

function toCandidate(row: CandidateRow): MailCandidate {
  const address = row.address ?? "";
  return {
    id: row.id,
    message_id: row.message_id,
    source: row.source,
    address,
    to_address: row.to_address,
    recipient: (row.to_address || address).toLowerCase(),
    received_at: Math.floor(parseD1Utc(row.created_at) / MS_PER_SECOND),
  };
}

async function runQuery(db: D1Database, sql: string, params: unknown[]): Promise<MailCandidate[]> {
  const { results } = await db.prepare(sql).bind(...params).all<CandidateRow>();
  return results.map(toCandidate);
}

export type ListCandidatesParams = {
  /** 收件地址，导入时的写法即可；两种大小写形式由这里展开 */
  addresses: readonly string[];
  /** 时间下界，Unix 秒（`created_at >= since`） */
  since?: number | null;
  /** 游标：只取 id 更小的 */
  beforeId?: number | null;
  limit: number;
};

/** 候选列表的 SQL 与绑定参数（单独导出，测试里用 EXPLAIN QUERY PLAN 确认走索引） */
export function buildListCandidatesQuery(
  params: ListCandidatesParams,
  capabilities: MailCapabilities,
): { sql: string; params: unknown[] } {
  const query = new QueryBuilder();
  query.where(recipientIn(query.bind(JSON.stringify(expandAddressForms(params.addresses))), capabilities));
  if (params.since != null) query.where(`created_at >= ${query.bind(formatD1Utc(params.since * MS_PER_SECOND))}`);
  if (params.beforeId != null) query.where(`id < ${query.bind(params.beforeId)}`);
  const sql = `${selectColumns(capabilities)} ${query.whereClause()} ORDER BY id DESC LIMIT ${query.bind(params.limit)}`;
  return { sql, params: query.params };
}

/** 候选列表，id 倒序 */
export async function listCandidates(db: D1Database, params: ListCandidatesParams): Promise<MailCandidate[]> {
  const capabilities = (await requireMailSchema(db)).capabilities;
  if (params.addresses.length === 0) return [];
  const query = buildListCandidatesQuery(params, capabilities);
  return await runQuery(db, query.sql, query.params);
}

export type ListAfterParams = {
  addresses: readonly string[];
  /** 增量轮询：只取 id 更大的 */
  afterId: number;
  since?: number | null;
  limit: number;
};

/** 增量轮询，id 正序（一次取不完时调用方用最大的 id 继续） */
export async function listAfter(db: D1Database, params: ListAfterParams): Promise<MailCandidate[]> {
  const capabilities = (await requireMailSchema(db)).capabilities;
  if (params.addresses.length === 0) return [];
  const query = new QueryBuilder();
  query.where(recipientIn(query.bind(JSON.stringify(expandAddressForms(params.addresses))), capabilities));
  query.where(`id > ${query.bind(params.afterId)}`);
  if (params.since != null) query.where(`created_at >= ${query.bind(formatD1Utc(params.since * MS_PER_SECOND))}`);
  const sql = `${selectColumns(capabilities)} ${query.whereClause()} ORDER BY id ASC LIMIT ${query.bind(params.limit)}`;
  return await runQuery(db, sql, query.params);
}

/** 按 id 取单封候选；不存在返回 null */
export async function getCandidateById(db: D1Database, id: number): Promise<MailCandidate | null> {
  const capabilities = (await requireMailSchema(db)).capabilities;
  const sql = `${selectColumns(capabilities)} WHERE id = ?1`;
  return (await runQuery(db, sql, [id]))[0] ?? null;
}

function addScopeCondition(query: QueryBuilder, filters: AdminMailFilters, capabilities: MailCapabilities): void {
  if (filters.scope === "all") return;
  const imported = filters.importedAddresses ?? [];
  if (imported.length > IMPORTED_SCOPE_MAX_ADDRESSES) {
    throw new ApiError(
      HTTP_UNPROCESSABLE,
      "scope_too_large",
      `已导入地址有 ${imported.length} 个，超过范围过滤的上限 ${IMPORTED_SCOPE_MAX_ADDRESSES}；请改用地址过滤或选择"全部"`,
    );
  }
  if (imported.length === 0) {
    // 没有已导入地址：imported 什么都不匹配，unknown 等同于全部
    if (filters.scope === "imported") query.where("0");
    return;
  }
  const placeholder = query.bind(JSON.stringify(expandAddressForms(imported)));
  query.where(filters.scope === "imported" ? recipientIn(placeholder, capabilities) : notRecipientIn(placeholder, capabilities));
}

/** 管理员手输的过滤条件：不区分大小写（本地部分的大小写由发件方决定，手输时没法猜）。代价是不走索引，仅限管理员接口 */
function addTextFilter(query: QueryBuilder, column: string, value: string | undefined): void {
  if (value === undefined) return;
  query.where(`${column} = ${query.bind(value)} COLLATE NOCASE`);
}

function buildAdminQuery(filters: AdminMailFilters, capabilities: MailCapabilities): QueryBuilder {
  if (filters.toAddress !== undefined && !capabilities.to_address) {
    throw new ApiError(HTTP_BAD_REQUEST, "to_address_unsupported", "MAIL_DB 的 raw_mails 没有 to_address 列，不能按它过滤");
  }
  const query = new QueryBuilder();
  addScopeCondition(query, filters, capabilities);
  addTextFilter(query, "address", filters.address);
  addTextFilter(query, "to_address", filters.toAddress);
  addTextFilter(query, "source", filters.source);
  if (filters.since !== undefined) query.where(`created_at >= ${query.bind(formatD1Utc(filters.since * MS_PER_SECOND))}`);
  if (filters.until !== undefined) query.where(`created_at <= ${query.bind(formatD1Utc(filters.until * MS_PER_SECOND))}`);
  if (filters.beforeId !== undefined) query.where(`id < ${query.bind(filters.beforeId)}`);
  if (filters.afterId !== undefined) query.where(`id > ${query.bind(filters.afterId)}`);
  return query;
}

/**
 * 管理员"全部邮件"：不带地址条件，按需过滤。
 * afterId 存在时按 id 正序（增量轮询），否则按 id 倒序。
 * "已导入地址"来自 APP_DB，不能跨库 JOIN，所以作为 JSON 数组传入（数量上限见 IMPORTED_SCOPE_MAX_ADDRESSES）。
 */
export async function listAdminMails(db: D1Database, filters: AdminMailFilters): Promise<MailCandidate[]> {
  const capabilities = (await requireMailSchema(db)).capabilities;
  const query = buildAdminQuery(filters, capabilities);
  const order = filters.afterId === undefined ? "DESC" : "ASC";
  const sql = `${selectColumns(capabilities)} ${query.whereClause()} ORDER BY id ${order} LIMIT ${query.bind(filters.limit)}`;
  return await runQuery(db, sql, query.params);
}
