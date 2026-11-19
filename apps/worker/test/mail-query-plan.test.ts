import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { buildListCandidatesQuery } from "../src/mail-source/candidates";
import { setupMailDb } from "./helpers";

// 取件链接的热路径：必须走 address / to_address 的索引，不能倒序扫全表。
// 索引定义取自 cloudflare_temp_email 的 db/schema.sql。

const INDEXES = [
  "CREATE INDEX idx_raw_mails_address ON raw_mails(address)",
  "CREATE INDEX idx_raw_mails_to_address ON raw_mails(to_address)",
  "CREATE INDEX idx_raw_mails_created_at ON raw_mails(created_at)",
];

async function plan(sql: string, params: unknown[]): Promise<string[]> {
  const { results } = await env.MAIL_DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>();
  return results.map((row) => row.detail);
}

describe("候选 SQL 的查询计划", () => {
  beforeEach(async () => {
    await setupMailDb();
    for (const statement of INDEXES) await env.MAIL_DB.prepare(statement).run();
    // 要有一定数据量和统计信息，规划器才会按真实选择性做决定（几百行的小表它宁可顺序扫）
    await env.MAIL_DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 20000)
       INSERT INTO raw_mails (message_id, source, address, to_address, raw, created_at)
       SELECT 'm' || i, 's@x.org', 'u' || (i % 2000) || '@example.com',
              CASE WHEN i % 2 = 0 THEN 't' || (i % 2000) || '@example.com' END, 'x', datetime(1700000000 + i, 'unixepoch')
       FROM n`,
    ).run();
    await env.MAIL_DB.prepare("ANALYZE").run();
  });

  it("带游标与时间下界的正向匹配：用 to_address / address 索引，不全表扫描", async () => {
    const query = buildListCandidatesQuery(
      { addresses: ["t1@example.com", "u3@example.com"], since: 1_700_000_000, beforeId: 1_000_000, limit: 20 },
      { to_address: true, raw_blob: true, metadata: true },
    );
    const details = await plan(query.sql, query.params);
    console.log(["EXPLAIN QUERY PLAN（候选查询）", ...details].join("\n  "));
    expect(details.some((detail) => /SEARCH raw_mails USING INDEX idx_raw_mails_(to_address|address)/.test(detail))).toBe(true);
    // 没有全表扫描，也没有"沿主键倒序扫到凑满 LIMIT"
    expect(details.some((detail) => /SCAN raw_mails|USING INTEGER PRIMARY KEY/.test(detail))).toBe(false);
  });

  it("正向匹配的 SQL 里没有 COALESCE（只有 unknown 范围的取反才有）", () => {
    const query = buildListCandidatesQuery({ addresses: ["a@b.c"], limit: 1 }, { to_address: true, raw_blob: true, metadata: true });
    expect(query.sql).not.toContain("COALESCE");
  });

  it("缺 to_address 列时：只按 address 索引", async () => {
    const query = buildListCandidatesQuery(
      { addresses: ["u3@example.com"], limit: 20 },
      { to_address: false, raw_blob: true, metadata: true },
    );
    const details = await plan(query.sql, query.params);
    expect(details.some((detail) => /INDEX idx_raw_mails_address/.test(detail))).toBe(true);
  });
});
