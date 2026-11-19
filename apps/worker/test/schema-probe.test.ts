import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { getMailSchema, probeMailSchema, resetMailSchemaCache } from "../src/mail-source";
import { setupMailDb } from "./helpers";

describe("probeMailSchema", () => {
  beforeEach(() => {
    resetMailSchemaCache();
  });

  it("完整表结构：健康，三个可选能力都在，读到 db_version", async () => {
    await setupMailDb();
    const probe = await probeMailSchema(env.MAIL_DB);
    expect(probe.healthy).toBe(true);
    expect(probe.table_exists).toBe(true);
    expect(probe.missing_required).toEqual([]);
    expect(probe.capabilities).toEqual({ to_address: true, raw_blob: true, metadata: true });
    expect(probe.db_version).toBe("v0.0.11");
    expect(probe.warnings).toEqual([]);
    expect(probe.columns).toEqual(
      expect.arrayContaining(["id", "message_id", "source", "address", "to_address", "raw", "raw_blob", "metadata", "created_at"]),
    );
  });

  it("缺 to_address：仍健康，能力标记为 false，并给出 iCloud 别名警告", async () => {
    await setupMailDb({ omitColumns: ["to_address"] });
    const probe = await probeMailSchema(env.MAIL_DB);
    expect(probe.healthy).toBe(true);
    expect(probe.capabilities.to_address).toBe(false);
    expect(probe.capabilities.raw_blob).toBe(true);
    expect(probe.warnings.some((w) => w.includes("to_address"))).toBe(true);
  });

  it("缺 raw_blob：仍健康，只读 raw", async () => {
    await setupMailDb({ omitColumns: ["raw_blob"] });
    const probe = await probeMailSchema(env.MAIL_DB);
    expect(probe.healthy).toBe(true);
    expect(probe.capabilities.raw_blob).toBe(false);
    expect(probe.capabilities.to_address).toBe(true);
  });

  it("缺 metadata：仍健康，不读取 temp_email 的提取结果", async () => {
    await setupMailDb({ omitColumns: ["metadata"] });
    const probe = await probeMailSchema(env.MAIL_DB);
    expect(probe.healthy).toBe(true);
    expect(probe.capabilities.metadata).toBe(false);
  });

  it.each(["id", "source", "address", "raw", "created_at"])("缺必需列 %s：不健康并列出缺失项", async (column) => {
    await setupMailDb({ omitColumns: [column] });
    const probe = await probeMailSchema(env.MAIL_DB);
    expect(probe.healthy).toBe(false);
    expect(probe.table_exists).toBe(true);
    expect(probe.missing_required).toEqual([column]);
  });

  it("raw_mails 表不存在：不健康，所有必需列都算缺失，columns 为空", async () => {
    await setupMailDb({ rawMails: false });
    const probe = await probeMailSchema(env.MAIL_DB);
    expect(probe.healthy).toBe(false);
    expect(probe.table_exists).toBe(false);
    expect(probe.columns).toEqual([]);
    expect(probe.missing_required).toEqual(["id", "source", "address", "raw", "created_at"]);
    expect(probe.capabilities).toEqual({ to_address: false, raw_blob: false, metadata: false });
  });

  it("没有 db_version 行：db_version 为 null 并给出警告，但不影响健康", async () => {
    await setupMailDb({ dbVersion: null });
    const probe = await probeMailSchema(env.MAIL_DB);
    expect(probe.healthy).toBe(true);
    expect(probe.db_version).toBeNull();
    expect(probe.warnings.some((w) => w.includes("db_version"))).toBe(true);
  });

  it("settings 表不存在：db_version 为 null，不抛错", async () => {
    await setupMailDb();
    await env.MAIL_DB.prepare("DROP TABLE settings").run();
    const probe = await probeMailSchema(env.MAIL_DB);
    expect(probe.db_version).toBeNull();
    expect(probe.healthy).toBe(true);
  });
});

describe("getMailSchema 缓存", () => {
  beforeEach(() => {
    resetMailSchemaCache();
  });

  it("健康结果被缓存；refresh 才会重探", async () => {
    await setupMailDb();
    const first = await getMailSchema(env.MAIL_DB);
    expect(first.capabilities.to_address).toBe(true);

    await env.MAIL_DB.prepare("ALTER TABLE raw_mails DROP COLUMN to_address").run();
    const cached = await getMailSchema(env.MAIL_DB);
    expect(cached.capabilities.to_address).toBe(true);

    const refreshed = await getMailSchema(env.MAIL_DB, { refresh: true });
    expect(refreshed.capabilities.to_address).toBe(false);
  });

  it("不健康的结果不缓存：表结构修复后下一次请求即恢复", async () => {
    await setupMailDb({ rawMails: false });
    const broken = await getMailSchema(env.MAIL_DB);
    expect(broken.healthy).toBe(false);

    // 直接补建表，不经过 setupMailDb（它会顺手清缓存，掩盖问题）
    await env.MAIL_DB
      .prepare("CREATE TABLE raw_mails (id INTEGER PRIMARY KEY, source TEXT, address TEXT, raw TEXT, created_at DATETIME)")
      .run();
    const fixed = await getMailSchema(env.MAIL_DB);
    expect(fixed.healthy).toBe(true);
  });
});
