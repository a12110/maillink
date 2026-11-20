import { RULE_GROUP_API_LIMITS, type RuleGroupUsage } from "@maillink/shared";

// rule_groups 的读写（APP_DB，全部参数化）。引用方：share_links.rule_group_id、user_mailbox_grants.rule_group_id（均 ON DELETE RESTRICT）。

export type RuleGroupRow = {
  id: number;
  name: string;
  description: string | null;
  schema_version: number;
  revision: number;
  config: string;
  created_at: number;
  updated_at: number;
  link_count: number;
  grant_count: number;
};

const SELECT_RULE_GROUPS = `
  SELECT r.id, r.name, r.description, r.schema_version, r.revision, r.config, r.created_at, r.updated_at,
    (SELECT COUNT(*) FROM share_links s WHERE s.rule_group_id = r.id) AS link_count,
    (SELECT COUNT(*) FROM user_mailbox_grants g WHERE g.rule_group_id = r.id) AS grant_count
  FROM rule_groups r`;

export type RuleGroupWrite = {
  name: string;
  description: string | null;
  schema_version: number;
  /** 已序列化的配置 JSON */
  config: string;
};

/** 规则组数量很少（模板 + 手建），列表一次返回，按 id 正序 */
export async function listRuleGroupRows(db: D1Database): Promise<RuleGroupRow[]> {
  const { results } = await db.prepare(`${SELECT_RULE_GROUPS} ORDER BY r.id`).all<RuleGroupRow>();
  return results;
}

export function findRuleGroupRow(db: D1Database, id: number): Promise<RuleGroupRow | null> {
  return db.prepare(`${SELECT_RULE_GROUPS} WHERE r.id = ?`).bind(id).first<RuleGroupRow>();
}

/** 新增语句（setup 与创建接口共用）；createdBy 可以是子查询结果，所以由调用方给出 SQL 片段与参数 */
export function insertRuleGroupStatement(db: D1Database, group: RuleGroupWrite, createdBy: number | null, now: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO rule_groups (name, description, schema_version, revision, config, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .bind(group.name, group.description, group.schema_version, group.config, createdBy, now, now);
}

/** 名称冲突时抛出 D1 唯一约束错误，由调用方用 uniqueViolationTarget 识别 */
export async function insertRuleGroup(db: D1Database, group: RuleGroupWrite, createdBy: number, now: number): Promise<number> {
  const result = await insertRuleGroupStatement(db, group, createdBy, now).run();
  return result.meta.last_row_id;
}

/** 乐观锁更新：revision 与库里一致才写，写入后 revision + 1。返回是否写入 */
export async function updateRuleGroup(db: D1Database, id: number, revision: number, group: RuleGroupWrite, now: number): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE rule_groups SET name = ?, description = ?, schema_version = ?, config = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND revision = ?`,
    )
    .bind(group.name, group.description, group.schema_version, group.config, now, id, revision)
    .run();
  return result.meta.changes > 0;
}

/** 没有任何引用时才删除（条件写在同一条语句里）。返回是否删除 */
export async function deleteUnusedRuleGroup(db: D1Database, id: number): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM rule_groups WHERE id = ?1
       AND NOT EXISTS (SELECT 1 FROM share_links WHERE rule_group_id = ?1)
       AND NOT EXISTS (SELECT 1 FROM user_mailbox_grants WHERE rule_group_id = ?1)`,
    )
    .bind(id)
    .run();
  return result.meta.changes > 0;
}

export async function findRuleGroupUsage(db: D1Database, id: number): Promise<RuleGroupUsage> {
  const max = RULE_GROUP_API_LIMITS.usageListMax;
  const [links, grants, counts] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT id, name, status FROM share_links WHERE rule_group_id = ? ORDER BY id LIMIT ?").bind(id, max),
    db
      .prepare(
        `SELECT g.id, g.user_id, u.username, g.mailbox_id, m.address FROM user_mailbox_grants g
         JOIN users u ON u.id = g.user_id JOIN mailboxes m ON m.id = g.mailbox_id
         WHERE g.rule_group_id = ? ORDER BY g.id LIMIT ?`,
      )
      .bind(id, max),
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM share_links WHERE rule_group_id = ?1) AS link_count,
                (SELECT COUNT(*) FROM user_mailbox_grants WHERE rule_group_id = ?1) AS grant_count`,
      )
      .bind(id),
  ]);
  const count = (counts?.results[0] ?? { link_count: 0, grant_count: 0 }) as { link_count: number; grant_count: number };
  return {
    link_count: count.link_count,
    grant_count: count.grant_count,
    links: (links?.results ?? []) as RuleGroupUsage["links"],
    grants: (grants?.results ?? []) as RuleGroupUsage["grants"],
  };
}
