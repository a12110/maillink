import { builtinRuleGroupTemplates } from "@maillink/shared";
import { firstAdminStatement } from "./users";

// 初始化（03 §2）：首个管理员与内置规则组模板（02 §9、06 §3）写在同一个 batch 里（D1 batch 是一个事务）。
// 模板只在本 batch 的管理员插入真正发生时写入：以"存在 username_lc 与 created_at 都等于本次的用户"为准；
// 并发的另一次初始化若已抢先，它的模板已经存在（同名跳过），本 batch 整体什么都不写。

export async function insertFirstAdminWithTemplates(
  db: D1Database,
  admin: { username: string; password_hash: string },
  now: number,
): Promise<number | null> {
  const templates = builtinRuleGroupTemplates().map((template) =>
    db
      .prepare(
        `INSERT INTO rule_groups (name, description, schema_version, revision, config, created_by, created_at, updated_at)
         SELECT ?1, ?2, ?3, 1, ?4, (SELECT id FROM users WHERE username_lc = ?5), ?6, ?6
         WHERE EXISTS (SELECT 1 FROM users WHERE username_lc = ?5 AND created_at = ?6)
           AND NOT EXISTS (SELECT 1 FROM rule_groups WHERE name = ?1)`,
      )
      .bind(
        template.name,
        template.description,
        template.config.schema_version,
        JSON.stringify(template.config),
        admin.username.toLowerCase(),
        now,
      ),
  );
  const [adminResult] = await db.batch([firstAdminStatement(db, admin, now), ...templates]);
  return adminResult && adminResult.meta.changes > 0 ? adminResult.meta.last_row_id : null;
}
