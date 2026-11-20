import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

const EXPECTED_TABLES = [
  "users",
  "user_recovery_codes",
  "user_passkeys",
  "oauth_providers",
  "user_identities",
  "sessions",
  "mailboxes",
  "mailbox_tags",
  "rule_groups",
  "share_links",
  "share_link_mailboxes",
  "link_visitors",
  "link_deliveries",
  "user_mailbox_grants",
  "mail_index",
  "link_access_logs",
  "audit_logs",
  "settings",
  "auth_flow_tokens",
];

const EXPECTED_INDEXES = [
  "idx_users_email",
  "idx_sessions_user",
  "idx_slm_mailbox",
  "idx_ld_link_time",
  "idx_ld_link_mail",
  "idx_mail_index_recipient",
  "idx_mailbox_tags_tag",
  "idx_share_links_rule_group",
  "idx_umg_mailbox",
  "idx_umg_rule_group",
  "idx_lal_link",
  "idx_auth_flow_tokens_expires",
];

async function listSchemaObjects(type: "table" | "index"): Promise<string[]> {
  const { results } = await env.APP_DB
    .prepare("SELECT name FROM sqlite_master WHERE type = ?1 AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
    .bind(type)
    .all<{ name: string }>();
  return results.map((row) => row.name);
}

describe("APP_DB 迁移", () => {
  beforeEach(async () => {
    // reset() 清空所有绑定的存储，回到空库后从头执行迁移
    await reset();
  });

  it("空库上执行成功，全部表与索引都存在", async () => {
    expect(await listSchemaObjects("table")).toEqual([]);
    await applyD1Migrations(env.APP_DB, env.TEST_MIGRATIONS);

    const tables = await listSchemaObjects("table");
    expect(tables).toEqual(expect.arrayContaining(EXPECTED_TABLES));
    const indexes = await listSchemaObjects("index");
    expect(indexes).toEqual(expect.arrayContaining(EXPECTED_INDEXES));
  });

  it("重复执行是幂等的（已应用的迁移不会再跑）", async () => {
    await applyD1Migrations(env.APP_DB, env.TEST_MIGRATIONS);
    await applyD1Migrations(env.APP_DB, env.TEST_MIGRATIONS);
    expect(await listSchemaObjects("table")).toEqual(expect.arrayContaining(EXPECTED_TABLES));
  });

  it("约束生效：role 的 CHECK 与外键", async () => {
    await applyD1Migrations(env.APP_DB, env.TEST_MIGRATIONS);

    await expect(
      env.APP_DB
        .prepare(
          "INSERT INTO users (username, username_lc, role, created_at, updated_at) VALUES ('a', 'a', 'root', 0, 0)",
        )
        .run(),
    ).rejects.toThrow();

    await expect(
      env.APP_DB
        .prepare("INSERT INTO mailbox_tags (mailbox_id, tag) VALUES (999, 'x')")
        .run(),
    ).rejects.toThrow();
  });

  it("AUTOINCREMENT 主键与默认值", async () => {
    await applyD1Migrations(env.APP_DB, env.TEST_MIGRATIONS);
    await env.APP_DB
      .prepare("INSERT INTO users (username, username_lc, role, created_at, updated_at) VALUES ('Admin', 'admin', 'admin', 1, 1)")
      .run();
    const row = await env.APP_DB
      .prepare("SELECT id, status FROM users WHERE username_lc = 'admin'")
      .first<{ id: number; status: string }>();
    expect(row).toEqual({ id: 1, status: "active" });
  });
});
