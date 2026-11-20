import { Hono } from "hono";
import type { Context } from "hono";
import {
  RULE_GROUP_API_LIMITS,
  ruleGroupCreateSchema,
  ruleGroupDraftRequestSchema,
  ruleGroupTestRequestSchema,
  ruleGroupUpdateSchema,
  validateRuleGroupConfig,
  type AdminRuleGroupDetail,
  type AdminRuleGroupList,
  type AdminRuleGroupSummary,
  type OkResponse,
  type RuleGroupConfig,
  type RuleGroupIssue,
  type RuleGroupSaveResponse,
  type RuleGroupTestResponse,
  type ValidateRuleGroupOptions,
} from "@maillink/shared";
import { testRuleGroup } from "../access";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { nowSec } from "../clock";
import { uniqueViolationTarget } from "../db/errors";
import {
  deleteUnusedRuleGroup,
  findRuleGroupRow,
  findRuleGroupUsage,
  insertRuleGroup,
  listRuleGroupRows,
  updateRuleGroup,
  type RuleGroupRow,
  type RuleGroupWrite,
} from "../db/rule-groups";
import type { AppEnv } from "../env";
import { ApiError, notFoundError } from "../errors";
import { HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_CREATED, HTTP_OK, HTTP_UNPROCESSABLE } from "../http-status";
import { getOrBuild } from "../mail-index";
import { getCandidateById } from "../mail-source";
import { compileRuleGroup, draftRuleFromMail } from "../rules";
import { parseIdParam, parseJsonBody } from "../validate";

// 管理端"规则组"（04 管理端 / 规则组，02 §8 测试器）。鉴权由 index.ts 对 /api/admin/* 统一挂载的 requireAdmin 保证。

export const adminRuleGroupRoutes = new Hono<AppEnv>();

// 测试器与草稿会带出邮件内容；整个路由一律不缓存
adminRuleGroupRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

type CompileState = { invalid: boolean; invalid_code: string | null; view: AdminRuleGroupSummary["view"]; issues: RuleGroupIssue[] };

function compileState(configText: string): CompileState {
  let raw: unknown;
  try {
    raw = JSON.parse(configText);
  } catch {
    return { invalid: true, invalid_code: "rule_group_invalid", view: null, issues: [] };
  }
  const result = compileRuleGroup(raw);
  if (!result.ok) return { invalid: true, invalid_code: result.error.code, view: null, issues: result.error.issues };
  return { invalid: false, invalid_code: null, view: result.compiled.config.present.view, issues: [] };
}

function toSummary(row: RuleGroupRow, state: CompileState): AdminRuleGroupSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    schema_version: row.schema_version,
    revision: row.revision,
    invalid: state.invalid,
    invalid_code: state.invalid_code,
    view: state.view,
    link_count: row.link_count,
    grant_count: row.grant_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toDetail(row: RuleGroupRow): AdminRuleGroupDetail {
  const state = compileState(row.config);
  let config: unknown = null;
  try {
    config = JSON.parse(row.config);
  } catch {
    // 原文不是 JSON：invalid 已标出，config 返回 null，编辑器提示重填
  }
  return { ...toSummary(row, state), config, issues: state.issues };
}

async function requireRuleGroup(db: D1Database, id: number): Promise<RuleGroupRow> {
  const row = await findRuleGroupRow(db, id);
  if (!row) throw notFoundError("规则组不存在");
  return row;
}

/** 校验失败：400 并附 issues（错误）与 warnings，编辑器按 path 定位 */
function invalidConfigResponse(c: Context<AppEnv>, errors: RuleGroupIssue[], warnings: RuleGroupIssue[]) {
  return c.json(
    { error: { code: "rule_group_invalid", message: "规则组配置不合法", issues: errors, warnings } },
    HTTP_BAD_REQUEST,
  );
}

type Validated = { ok: true; config: RuleGroupConfig; warnings: RuleGroupIssue[] } | { ok: false; errors: RuleGroupIssue[]; warnings: RuleGroupIssue[] };

function validateConfig(config: unknown, options: ValidateRuleGroupOptions = {}): Validated {
  const result = validateRuleGroupConfig(config, options);
  return result.ok ? { ok: true, config: result.config, warnings: result.warnings } : { ok: false, errors: result.errors, warnings: result.warnings };
}

function toWrite(body: { name: string; description?: string | null }, config: RuleGroupConfig): RuleGroupWrite {
  return { name: body.name, description: body.description ?? null, schema_version: config.schema_version, config: JSON.stringify(config) };
}

async function mapNameConflict<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (uniqueViolationTarget(error) === "rule_groups.name") {
      throw new ApiError(HTTP_CONFLICT, "rule_group_name_taken", "已有同名规则组");
    }
    throw error;
  }
}

adminRuleGroupRoutes.get("/", async (c) => {
  const rows = await listRuleGroupRows(c.env.APP_DB);
  const body: AdminRuleGroupList = { items: rows.map((row) => toSummary(row, compileState(row.config))), next_cursor: null };
  return c.json(body, HTTP_OK);
});

adminRuleGroupRoutes.post("/", async (c) => {
  const db = c.env.APP_DB;
  const body = await parseJsonBody(c, ruleGroupCreateSchema);
  const validated = validateConfig(body.config);
  if (!validated.ok) return invalidConfigResponse(c, validated.errors, validated.warnings);
  const actorId = c.get("auth").user.id;
  const id = await mapNameConflict(insertRuleGroup(db, toWrite(body, validated.config), actorId, nowSec()));
  const created = await requireRuleGroup(db, id);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.ruleGroupCreate,
    actorUserId: actorId,
    targetType: "rule_group",
    targetId: id,
    detail: { name: created.name, config: validated.config },
  });
  const response: RuleGroupSaveResponse = { rule_group: toDetail(created), warnings: validated.warnings };
  return c.json(response, HTTP_CREATED);
});

adminRuleGroupRoutes.get("/:id", async (c) => {
  return c.json(toDetail(await requireRuleGroup(c.env.APP_DB, parseIdParam(c))), HTTP_OK);
});

adminRuleGroupRoutes.put("/:id", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const body = await parseJsonBody(c, ruleGroupUpdateSchema);
  const before = await requireRuleGroup(db, id);
  const validated = validateConfig(body.config);
  if (!validated.ok) return invalidConfigResponse(c, validated.errors, validated.warnings);
  const written = await mapNameConflict(updateRuleGroup(db, id, body.revision, toWrite(body, validated.config), nowSec()));
  if (!written) {
    const current = await requireRuleGroup(db, id);
    throw new ApiError(HTTP_CONFLICT, "revision_conflict", `规则组已被修改（当前版本 ${current.revision}），请刷新后再保存`);
  }
  const after = await requireRuleGroup(db, id);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.ruleGroupUpdate,
    actorUserId: c.get("auth").user.id,
    targetType: "rule_group",
    targetId: id,
    detail: {
      before: { name: before.name, description: before.description, revision: before.revision, config: before.config },
      after: { name: after.name, description: after.description, revision: after.revision },
    },
  });
  const response: RuleGroupSaveResponse = { rule_group: toDetail(after), warnings: validated.warnings };
  return c.json(response, HTTP_OK);
});

adminRuleGroupRoutes.delete("/:id", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const before = await requireRuleGroup(db, id);
  if (!(await deleteUnusedRuleGroup(db, id))) {
    await requireRuleGroup(db, id);
    const usage = await findRuleGroupUsage(db, id);
    return c.json(
      {
        error: {
          code: "rule_group_in_use",
          message: `规则组仍被 ${usage.link_count} 个链接、${usage.grant_count} 个授权引用，不能删除`,
          usage,
        },
      },
      HTTP_CONFLICT,
    );
  }
  await recordAudit(c, {
    action: AUDIT_ACTIONS.ruleGroupDelete,
    actorUserId: c.get("auth").user.id,
    targetType: "rule_group",
    targetId: id,
    detail: { name: before.name, revision: before.revision, config: before.config },
  });
  const ok: OkResponse = { status: "ok" };
  return c.json(ok, HTTP_OK);
});

adminRuleGroupRoutes.get("/:id/usage", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  await requireRuleGroup(db, id);
  return c.json(await findRuleGroupUsage(db, id), HTTP_OK);
});

adminRuleGroupRoutes.post("/test", async (c) => {
  const body = await parseJsonBody(c, ruleGroupTestRequestSchema);
  // 测试器随编辑实时调用：不试跑正则计时（保存时才做），其余校验与保存相同
  const validated = validateConfig(body.config, { regexProbe: "skip" });
  if (!validated.ok) return invalidConfigResponse(c, validated.errors, validated.warnings);
  const compiled = compileRuleGroup(validated.config);
  if (!compiled.ok) throw new Error(`校验通过的配置编译失败：${compiled.error.message}`);
  const targets = body.addresses !== undefined ? { addresses: body.addresses } : { mailIds: body.mail_ids ?? [] };
  const result = await testRuleGroup(c.env, compiled.compiled, targets, {
    now: nowSec(),
    anchorAt: body.anchor_at,
    limit: body.limit ?? RULE_GROUP_API_LIMITS.testDefaultMails,
  });
  const response: RuleGroupTestResponse = { ...result, warnings: validated.warnings };
  return c.json(response, HTTP_OK);
});

adminRuleGroupRoutes.post("/draft-from-mail", async (c) => {
  const { mail_id: mailId } = await parseJsonBody(c, ruleGroupDraftRequestSchema);
  const candidate = await getCandidateById(c.env.MAIL_DB, mailId);
  if (!candidate) throw notFoundError("邮件不存在");
  const item = (await getOrBuild(c.env, [candidate], { maxParse: 1 })).items[0];
  if (!item) throw notFoundError("邮件不存在");
  if (item.status !== "ok") {
    throw new ApiError(HTTP_UNPROCESSABLE, "mail_parse_failed", "这封邮件解析失败，无法生成规则草稿");
  }
  return c.json(draftRuleFromMail(item.facts), HTTP_OK);
});
