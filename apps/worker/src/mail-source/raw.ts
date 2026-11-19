import { RAW_FETCH_CHUNK } from "../constants";
import { blobToBytes, gunzipToText } from "./gzip";
import type { D1Blob } from "./gzip";
import { requireMailSchema } from "./guard";
import type { RawMailResult } from "./types";

type RawRow = {
  id: number;
  raw: string | null;
  raw_blob?: D1Blob;
  metadata?: string | null;
};

const EMPTY_RAW_ERROR = "raw 与 raw_blob 均为空，没有可解析的邮件原文";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function resolveRow(row: RawRow): Promise<RawMailResult> {
  const metadata = row.metadata ? row.metadata : null;
  const blob = blobToBytes(row.raw_blob);
  if (blob.length > 0) {
    try {
      return { ok: true, id: row.id, raw: await gunzipToText(blob), metadata };
    } catch (error) {
      // 不回退到 raw：同一封邮件只会写其中一列，回退只会掩盖数据损坏
      return { ok: false, id: row.id, error: `raw_blob 解压失败：${describeError(error)}` };
    }
  }
  if (row.raw) return { ok: true, id: row.id, raw: row.raw, metadata };
  return { ok: false, id: row.id, error: EMPTY_RAW_ERROR };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

/**
 * 按 RAW_FETCH_CHUNK 分批取邮件原文（raw 可能接近 2 MB，不能一次取很多）。
 * 返回结果只含 MAIL_DB 里仍存在的邮件；已被删除的 id 不出现在结果里。
 * 缺 raw_blob / metadata 列时只读已有的列。
 */
export async function getRawBatch(db: D1Database, ids: readonly number[]): Promise<RawMailResult[]> {
  const schema = await requireMailSchema(db);
  const columns = [
    "id",
    "raw",
    schema.capabilities.raw_blob ? "raw_blob" : null,
    schema.capabilities.metadata ? "metadata" : null,
  ].filter((name) => name !== null);
  const sql = `SELECT ${columns.join(", ")} FROM raw_mails WHERE id IN (SELECT value FROM json_each(?1))`;

  const results: RawMailResult[] = [];
  for (const batch of chunk(ids, RAW_FETCH_CHUNK)) {
    const { results: rows } = await db.prepare(sql).bind(JSON.stringify(batch)).all<RawRow>();
    results.push(...(await Promise.all(rows.map(resolveRow))));
  }
  return results;
}
