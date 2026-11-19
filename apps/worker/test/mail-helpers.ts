import { env } from "cloudflare:workers";
import type { MailCandidate } from "../src/mail-source";

// 邮件相关测试的公共工具。测试允许写本地 MAIL_DB（与种子脚本同理），src/mail-source 不允许。

const fixtures = import.meta.glob("./fixtures/*.eml", { query: "?raw", import: "default", eager: true });

/** 读 test/fixtures 下的合成样本 */
export function fixture(name: string): string {
  const raw = fixtures[`./fixtures/${name}`];
  if (raw === undefined) throw new Error(`找不到样本 ${name}`);
  return raw;
}

export async function gzipBytes(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

export type MailRowInput = {
  id?: number;
  message_id?: string | null;
  source?: string | null;
  address?: string;
  to_address?: string | null;
  raw?: string | null;
  raw_blob?: ArrayBuffer | null;
  metadata?: string | null;
  /** `YYYY-MM-DD HH:MM:SS`，默认当前时间 */
  created_at?: string;
};

/** 往本地 MAIL_DB 写一封邮件，返回 id。只写调用方给出的列（用于缺列场景） */
export async function insertMail(row: MailRowInput, columns?: readonly string[]): Promise<number> {
  const values: Record<string, unknown> = {
    id: row.id,
    message_id: row.message_id ?? `<m-${Math.random().toString(36).slice(2)}@test>`,
    source: row.source === undefined ? "sender@example.org" : row.source,
    address: row.address ?? "box@example.com",
    to_address: row.to_address === undefined ? null : row.to_address,
    raw: row.raw === undefined ? null : row.raw,
    raw_blob: row.raw_blob ?? null,
    metadata: row.metadata ?? null,
    created_at: row.created_at ?? new Date().toISOString().slice(0, 19).replace("T", " "),
  };
  const names = Object.keys(values).filter(
    (name) => values[name] !== undefined && (columns === undefined || columns.includes(name)),
  );
  const sql = `INSERT INTO raw_mails (${names.join(", ")}) VALUES (${names.map((_, i) => `?${i + 1}`).join(", ")})`;
  const result = await env.MAIL_DB.prepare(sql)
    .bind(...names.map((name) => values[name]))
    .run();
  return Number(result.meta.last_row_id);
}

/** 构造候选（不读库），用于直接测解析与索引 */
export function candidateOf(overrides: Partial<MailCandidate> & { id: number }): MailCandidate {
  const address = overrides.address ?? "box@example.com";
  const toAddress = overrides.to_address ?? null;
  return {
    message_id: "<c@test>",
    source: "sender@example.org",
    address,
    to_address: toAddress,
    recipient: (toAddress || address).toLowerCase(),
    received_at: 1_800_000_000,
    ...overrides,
  };
}

/** 秒级时间戳 → `YYYY-MM-DD HH:MM:SS` */
export function d1Time(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 19).replace("T", " ");
}
