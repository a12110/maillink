import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

// 0010（取码记录带邮件身份）：从带数据的 0008 状态执行，旧数据保留、唯一表达式索引生效、外键仍在。

const INSERT_DELIVERY =
  "INSERT INTO link_deliveries (link_id, mail_id, mail_message_id, mail_received_at, mail_recipient, visitor_hash, delivered_at) VALUES (1, ?, ?, ?, ?, 'v', 100)";

async function seedBefore0010(): Promise<void> {
  await applyD1Migrations(env.APP_DB, env.TEST_MIGRATIONS.filter((migration) => migration.name < "0010"));
  await env.APP_DB.batch([
    env.APP_DB.prepare("INSERT INTO rule_groups (id, name, schema_version, config, created_at, updated_at) VALUES (1, 'g', 1, '{}', 0, 0)"),
    env.APP_DB.prepare(
      "INSERT INTO share_links (id, token_hash, token_enc, token_hint, rule_group_id, access, created_at, updated_at) VALUES (1, 'h', 'e', 'hint', 1, '{}', 0, 0)",
    ),
    env.APP_DB.prepare("INSERT INTO link_deliveries (link_id, mail_id, visitor_hash, delivered_at) VALUES (1, 7, 'a', 11), (1, 8, 'b', 12)"),
  ]);
}

beforeEach(async () => {
  await reset();
  await seedBefore0010();
  await applyD1Migrations(env.APP_DB, env.TEST_MIGRATIONS);
});

describe("迁移 0010", () => {
  it("旧取码记录原样保留，身份列为 NULL", async () => {
    const { results } = await env.APP_DB
      .prepare("SELECT link_id, mail_id, mail_message_id, mail_received_at, mail_recipient, visitor_hash, delivered_at FROM link_deliveries ORDER BY mail_id")
      .all();
    expect(results).toEqual([
      { link_id: 1, mail_id: 7, mail_message_id: null, mail_received_at: null, mail_recipient: null, visitor_hash: "a", delivered_at: 11 },
      { link_id: 1, mail_id: 8, mail_message_id: null, mail_received_at: null, mail_recipient: null, visitor_hash: "b", delivered_at: 12 },
    ]);
  });

  it("唯一表达式索引：同一身份重复插入被拒（message_id 为 NULL 也一样）；同 id 不同身份可以写", async () => {
    await env.APP_DB.prepare(INSERT_DELIVERY).bind(9, "<m@x>", 500, "box@example.com").run();
    await expect(env.APP_DB.prepare(INSERT_DELIVERY).bind(9, "<m@x>", 500, "box@example.com").run()).rejects.toThrow(/UNIQUE/);
    await env.APP_DB.prepare(INSERT_DELIVERY).bind(10, null, 500, "box@example.com").run();
    await expect(env.APP_DB.prepare(INSERT_DELIVERY).bind(10, null, 500, "box@example.com").run()).rejects.toThrow(/UNIQUE/);
    await env.APP_DB.prepare(INSERT_DELIVERY).bind(9, "<reused@x>", 530, "box@example.com").run();
    const index = await env.APP_DB
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'ux_ld_mail_identity'")
      .first<{ sql: string }>();
    expect(index?.sql).toContain("UNIQUE");
  });

  it("重建后外键仍在：删除链接级联删除取码记录", async () => {
    await env.APP_DB.prepare("DELETE FROM share_links WHERE id = 1").run();
    expect(await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM link_deliveries").first()).toEqual({ n: 0 });
  });
});
