import { env } from "cloudflare:workers";
import type { RuleGroupConfigInput } from "@maillink/shared";
import { nowSec } from "../src/clock";
import { baseConfig } from "./access-helpers";

// 授权与收件箱测试的夹具：直接写库，绕过管理端接口（接口本身在 admin-grants.test.ts 里测）。

export async function insertMailbox(address: string, status: "active" | "disabled" = "active"): Promise<number> {
  const now = nowSec();
  const result = await env.APP_DB.prepare(
    "INSERT INTO mailboxes (address, address_lc, status, created_at, updated_at) VALUES (?1, lower(?1), ?2, ?3, ?3)",
  )
    .bind(address, status, now)
    .run();
  return result.meta.last_row_id;
}

export async function insertRuleGroup(name: string, config: unknown = baseConfig()): Promise<number> {
  const now = nowSec();
  const result = await env.APP_DB.prepare(
    "INSERT INTO rule_groups (name, schema_version, config, created_at, updated_at) VALUES (?1, 1, ?2, ?3, ?3)",
  )
    .bind(name, JSON.stringify(config), now)
    .run();
  return result.meta.last_row_id;
}

export type GrantFixture = {
  userId: number;
  mailboxId: number;
  ruleGroupId?: number | null;
  expiresAt?: number | null;
  firstAccessAt?: number | null;
  /** 默认比现在早很久：不影响只看"首次访问"或不限时间的规则组 */
  createdAt?: number;
};

const DEFAULT_GRANT_AGE_SEC = 10_000;

export async function insertGrant(grant: GrantFixture): Promise<number> {
  const result = await env.APP_DB.prepare(
    `INSERT INTO user_mailbox_grants (user_id, mailbox_id, rule_group_id, expires_at, first_access_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      grant.userId,
      grant.mailboxId,
      grant.ruleGroupId ?? null,
      grant.expiresAt ?? null,
      grant.firstAccessAt ?? null,
      grant.createdAt ?? nowSec() - DEFAULT_GRANT_AGE_SEC,
    )
    .run();
  return result.meta.last_row_id;
}

export async function grantRow(id: number): Promise<{ first_access_at: number | null; rule_group_id: number | null } | null> {
  return await env.APP_DB.prepare("SELECT first_access_at, rule_group_id FROM user_mailbox_grants WHERE id = ?")
    .bind(id)
    .first();
}

export function denySubjectConfig(value: string, overrides: Partial<RuleGroupConfigInput["present"]> = {}): RuleGroupConfigInput {
  return baseConfig({
    filter: {
      mode: "blacklist",
      rules: [{ id: "d", name: "屏蔽", enabled: true, effect: "deny", when: { field: "subject", op: "contains", value } }],
    },
    present: overrides,
  });
}

export function allowSubjectConfig(value: string): RuleGroupConfigInput {
  return baseConfig({
    filter: {
      mode: "whitelist",
      rules: [{ id: "a", name: "放行", enabled: true, effect: "allow", when: { field: "subject", op: "contains", value } }],
    },
  });
}

export async function setGrantExpiry(id: number, expiresAt: number | null): Promise<void> {
  await env.APP_DB.prepare("UPDATE user_mailbox_grants SET expires_at = ? WHERE id = ?").bind(expiresAt, id).run();
}

export async function setGrantRuleGroup(id: number, ruleGroupId: number | null): Promise<void> {
  await env.APP_DB.prepare("UPDATE user_mailbox_grants SET rule_group_id = ? WHERE id = ?").bind(ruleGroupId, id).run();
}

export async function setMailboxStatus(id: number, status: "active" | "disabled"): Promise<void> {
  await env.APP_DB.prepare("UPDATE mailboxes SET status = ? WHERE id = ?").bind(status, id).run();
}

export async function deleteGrantRow(id: number): Promise<void> {
  await env.APP_DB.prepare("DELETE FROM user_mailbox_grants WHERE id = ?").bind(id).run();
}
