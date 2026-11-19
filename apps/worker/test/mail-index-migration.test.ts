import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

// 0003：mail_index 新增 from_address 与 code_source（只新增，不改 0001）。

describe("0003_mail_index_extra", () => {
  beforeEach(async () => {
    await reset();
    await applyD1Migrations(env.APP_DB, env.TEST_MIGRATIONS);
  });

  it("mail_index 有 from_address 与 code_source 两个新列，原有列都还在", async () => {
    const { results } = await env.APP_DB.prepare("PRAGMA table_info(mail_index)").all<{ name: string }>();
    const names = results.map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining(["from_address", "code_source", "mail_id", "sender_address", "sender_domain", "parser_version"]),
    );
  });

  it("code_source 只接受 ai_extract / builtin / NULL", async () => {
    const insert = (codeSource: string | null) =>
      env.APP_DB
        .prepare(
          `INSERT INTO mail_index (mail_id, received_at, recipient, parse_status, parser_version, indexed_at, code_source)
           VALUES (?1, 0, 'a@b.c', 'ok', 1, 0, ?2)`,
        )
        .bind(Math.floor(Math.random() * 1e9), codeSource)
        .run();
    await insert("ai_extract");
    await insert("builtin");
    await insert(null);
    await expect(insert("regex")).rejects.toThrow();
  });
});
