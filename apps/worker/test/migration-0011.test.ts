import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

// 0011（口令校验的进行中占位）：从带数据的 0010 状态执行，已有失败记录原样保留，新表可用、外键级联。

async function seedBefore0011(): Promise<void> {
  await applyD1Migrations(env.APP_DB, env.TEST_MIGRATIONS.filter((migration) => migration.name < "0011"));
  await env.APP_DB.batch([
    env.APP_DB.prepare("INSERT INTO rule_groups (id, name, schema_version, config, created_at, updated_at) VALUES (1, 'g', 1, '{}', 0, 0)"),
    env.APP_DB.prepare(
      "INSERT INTO share_links (id, token_hash, token_enc, token_hint, rule_group_id, access, created_at, updated_at) VALUES (1, 'h', 'e', 'hint', 1, '{}', 0, 0)",
    ),
    env.APP_DB.prepare("INSERT INTO link_password_attempts (link_id, ip_bucket, created_at) VALUES (1, '198.51.100.1', 100), (1, '198.51.100.2', 101)"),
  ]);
}

beforeEach(async () => {
  await reset();
  await seedBefore0011();
  await applyD1Migrations(env.APP_DB, env.TEST_MIGRATIONS);
});

describe("迁移 0011", () => {
  it("已有的失败记录原样保留", async () => {
    const { results } = await env.APP_DB.prepare("SELECT link_id, ip_bucket, created_at FROM link_password_attempts ORDER BY created_at").all();
    expect(results).toEqual([
      { link_id: 1, ip_bucket: "198.51.100.1", created_at: 100 },
      { link_id: 1, ip_bucket: "198.51.100.2", created_at: 101 },
    ]);
  });

  it("link_password_inflight 可写、有索引；删除链接级联删除占位", async () => {
    await env.APP_DB.prepare("INSERT INTO link_password_inflight (link_id, ip_bucket, expires_at) VALUES (1, 'b', 200)").run();
    const index = await env.APP_DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_lpi_link_bucket'").first();
    expect(index).toEqual({ name: "idx_lpi_link_bucket" });
    await env.APP_DB.prepare("DELETE FROM share_links WHERE id = 1").run();
    expect(await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM link_password_inflight").first()).toEqual({ n: 0 });
    expect(await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM link_password_attempts").first()).toEqual({ n: 0 });
  });

});
