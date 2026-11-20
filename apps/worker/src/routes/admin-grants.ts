import { Hono } from "hono";
import {
  adminGrantListQuerySchema,
  grantBatchRequestSchema,
  grantPatchSchema,
  type AdminGrant,
  type AdminGrantListResponse,
  type GrantBatchResponse,
  type GrantBatchResult,
  type OkResponse,
} from "@maillink/shared";
import { compileStoredPolicy } from "../access";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { nowSec } from "../clock";
import {
  deleteGrant,
  findExistingMailboxIds,
  findGrantRow,
  findGrantsForPairs,
  findUserRoles,
  insertGrants,
  listGrantRows,
  pairKey,
  patchGrant,
  updateGrants,
  type GrantRow,
  type GrantSettings,
} from "../db/grants";
import { findRuleGroupRow } from "../db/rule-groups";
import type { AppEnv } from "../env";
import { ApiError, notFoundError } from "../errors";
import { HTTP_BAD_REQUEST, HTTP_OK } from "../http-status";
import { parseIdParam, parseJsonBody, parseQuery } from "../validate";

// 管理端"授权"（04 管理端 / 授权，03 §6）。鉴权由 index.ts 对 /api/admin/* 统一挂载的 requireAdmin 保证。

export const adminGrantRoutes = new Hono<AppEnv>();

adminGrantRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

function toAdminGrant(row: GrantRow, now: number): AdminGrant {
  const expired = row.expires_at !== null && row.expires_at <= now;
  return { ...row, expired, effective: !expired && row.mailbox_status === "active" };
}

/** 规则组必须存在且配置能编译：授权出去后配置失效会让用户整个邮箱不可见（失败关闭），所以保存时就拒绝 */
async function requireUsableRuleGroup(db: D1Database, id: number): Promise<void> {
  const row = await findRuleGroupRow(db, id);
  if (!row) throw new ApiError(HTTP_BAD_REQUEST, "rule_group_not_found", "规则组不存在");
  try {
    compileStoredPolicy(row.config);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    throw new ApiError(HTTP_BAD_REQUEST, error.code, `规则组「${row.name}」配置无效：${error.message}`);
  }
}

function requireFutureExpiry(expiresAt: number | null | undefined, now: number): void {
  if (typeof expiresAt === "number" && expiresAt <= now) {
    throw new ApiError(HTTP_BAD_REQUEST, "expires_at_in_past", "过期时间必须晚于现在；要立刻收回授权请直接删除");
  }
}

adminGrantRoutes.get("/", async (c) => {
  const query = parseQuery(c, adminGrantListQuerySchema);
  const { rows, next_cursor } = await listGrantRows(c.env.APP_DB, query);
  const now = nowSec();
  const body: AdminGrantListResponse = { items: rows.map((row) => toAdminGrant(row, now)), next_cursor };
  return c.json(body, HTTP_OK);
});

type Plan = {
  results: GrantBatchResult[];
  create: Array<{ user_id: number; mailbox_id: number }>;
  update: GrantRow[];
};

const sameSettings = (row: GrantRow, settings: GrantSettings) =>
  row.rule_group_id === settings.rule_group_id && row.expires_at === settings.expires_at;

type PlanInput = {
  userIds: number[];
  mailboxIds: number[];
  users: Map<number, unknown>;
  mailboxes: Set<number>;
  existing: Map<string, GrantRow>;
  settings: GrantSettings;
  onConflict: "skip" | "update";
};

/** 逐对判定：目标不存在 → failed；已存在按 on_conflict 跳过 / 更新（内容相同不写）；其余新建 */
function planBatch(input: PlanInput): Plan {
  const plan: Plan = { results: [], create: [], update: [] };
  const result = (user_id: number, mailbox_id: number, status: GrantBatchResult["status"], reason: GrantBatchResult["reason"], grant_id: number | null) =>
    plan.results.push({ user_id, mailbox_id, status, reason, grant_id });
  for (const userId of input.userIds) {
    for (const mailboxId of input.mailboxIds) {
      const row = input.existing.get(pairKey(userId, mailboxId));
      if (!input.users.has(userId)) result(userId, mailboxId, "failed", "user_not_found", null);
      else if (!input.mailboxes.has(mailboxId)) result(userId, mailboxId, "failed", "mailbox_not_found", null);
      else if (row === undefined) {
        plan.create.push({ user_id: userId, mailbox_id: mailboxId });
        result(userId, mailboxId, "created", null, null);
      } else if (input.onConflict === "skip") result(userId, mailboxId, "skipped", "already_exists", row.id);
      else if (sameSettings(row, input.settings)) result(userId, mailboxId, "skipped", "unchanged", row.id);
      else {
        plan.update.push(row);
        result(userId, mailboxId, "updated", null, row.id);
      }
    }
  }
  return plan;
}

/** 写入之后按实际结果修正计划里乐观标记的 created / updated（并发导致的抢先写入或删除） */
function reconcile(plan: Plan, inserted: Map<string, number>, updatedIds: Set<number>): void {
  const created = new Set(plan.create.map((target) => pairKey(target.user_id, target.mailbox_id)));
  for (const item of plan.results) {
    if (item.status === "created" && created.has(pairKey(item.user_id, item.mailbox_id))) {
      const id = inserted.get(pairKey(item.user_id, item.mailbox_id));
      if (id === undefined) Object.assign(item, { status: "skipped", reason: "already_exists" });
      else item.grant_id = id;
    } else if (item.status === "updated" && item.grant_id !== null && !updatedIds.has(item.grant_id)) {
      Object.assign(item, { status: "failed", reason: "grant_not_found", grant_id: null });
    }
  }
}

function summarize(results: readonly GrantBatchResult[]): GrantBatchResponse["summary"] {
  const count = (status: GrantBatchResult["status"]) => results.filter((item) => item.status === status).length;
  return { created: count("created"), updated: count("updated"), skipped: count("skipped"), failed: count("failed") };
}

adminGrantRoutes.post("/batch", async (c) => {
  const db = c.env.APP_DB;
  const body = await parseJsonBody(c, grantBatchRequestSchema);
  const now = nowSec();
  const settings: GrantSettings = { rule_group_id: body.rule_group_id, expires_at: body.expires_at };
  if (settings.rule_group_id !== null) await requireUsableRuleGroup(db, settings.rule_group_id);
  requireFutureExpiry(settings.expires_at, now);

  const userIds = [...new Set(body.user_ids)];
  const mailboxIds = [...new Set(body.mailbox_ids)];
  const users = await findUserRoles(db, userIds);
  const admins = userIds.filter((id) => users.get(id) === "admin");
  if (admins.length > 0) {
    throw new ApiError(HTTP_BAD_REQUEST, "grant_admin_user", `管理员不需要授权（用户 ${admins.join("、")}），请从用户列表中去掉`);
  }
  const mailboxes = await findExistingMailboxIds(db, mailboxIds);
  const existing = new Map((await findGrantsForPairs(db, userIds, mailboxIds)).map((row) => [pairKey(row.user_id, row.mailbox_id), row]));

  const plan = planBatch({ userIds, mailboxIds, users, mailboxes, existing, settings, onConflict: body.on_conflict });
  const actorId = c.get("auth").user.id;
  const inserted = await insertGrants(db, plan.create, settings, actorId, now);
  const updatedIds = new Set(await updateGrants(db, plan.update.map((row) => row.id), settings));
  reconcile(plan, inserted, updatedIds);

  const summary = summarize(plan.results);
  if (summary.created + summary.updated > 0) {
    await recordAudit(c, {
      action: AUDIT_ACTIONS.grantBatch,
      actorUserId: actorId,
      targetType: "grant",
      detail: {
        on_conflict: body.on_conflict,
        ...settings,
        summary,
        created: plan.results.filter((r) => r.status === "created").map((r) => ({ id: r.grant_id, user_id: r.user_id, mailbox_id: r.mailbox_id })),
        // 更新留下旧值
        updated: plan.update
          .filter((row) => updatedIds.has(row.id))
          .map((row) => ({ id: row.id, user_id: row.user_id, mailbox_id: row.mailbox_id, before: { rule_group_id: row.rule_group_id, expires_at: row.expires_at } })),
      },
    });
  }
  const response: GrantBatchResponse = { summary, results: plan.results };
  return c.json(response, HTTP_OK);
});

async function requireGrant(db: D1Database, id: number): Promise<GrantRow> {
  const row = await findGrantRow(db, id);
  if (!row) throw notFoundError("授权不存在");
  return row;
}

adminGrantRoutes.patch("/:id", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const patch = await parseJsonBody(c, grantPatchSchema);
  const now = nowSec();
  const before = await requireGrant(db, id);
  if (typeof patch.rule_group_id === "number") await requireUsableRuleGroup(db, patch.rule_group_id);
  requireFutureExpiry(patch.expires_at, now);
  if (!(await patchGrant(db, id, patch))) throw notFoundError("授权不存在");
  const after = await requireGrant(db, id);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.grantUpdate,
    actorUserId: c.get("auth").user.id,
    targetType: "grant",
    targetId: id,
    detail: {
      user_id: before.user_id,
      address: before.address,
      before: { rule_group_id: before.rule_group_id, rule_group_name: before.rule_group_name, expires_at: before.expires_at },
      patch,
    },
  });
  return c.json(toAdminGrant(after, now), HTTP_OK);
});

adminGrantRoutes.delete("/:id", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const before = await requireGrant(db, id);
  if (!(await deleteGrant(db, id))) throw notFoundError("授权不存在");
  await recordAudit(c, {
    action: AUDIT_ACTIONS.grantDelete,
    actorUserId: c.get("auth").user.id,
    targetType: "grant",
    targetId: id,
    detail: {
      user_id: before.user_id,
      username: before.username,
      mailbox_id: before.mailbox_id,
      address: before.address,
      rule_group_id: before.rule_group_id,
      rule_group_name: before.rule_group_name,
      expires_at: before.expires_at,
      first_access_at: before.first_access_at,
    },
  });
  const ok: OkResponse = { status: "ok" };
  return c.json(ok, HTTP_OK);
});
