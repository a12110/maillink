import { Hono } from "hono";
import type { Context } from "hono";
import {
  appearanceSettingsSchema,
  authSettingsSchema,
  linksSettingsSchema,
  logsSettingsSchema,
  securitySettingsSchema,
  settingGroupSchema,
  siteSettingsSchema,
  turnstileSettingsInputSchema,
} from "@maillink/shared";
import type { SettingGroup, SystemSettings, WritableSettingGroup } from "@maillink/shared";
import type { z } from "zod";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { readGroupFields, writeGroupFields } from "../db/settings-groups";
import { countMailIndexRows } from "../db/system-stats";
import type { AppEnv } from "../env";
import { ApiError, notFoundError } from "../errors";
import { HTTP_METHOD_NOT_ALLOWED } from "../http-status";
import { diffSettings } from "../settings-diff";
import { loadTurnstileConfig, toTurnstileSettings } from "../turnstile/config";
import { parseJsonBody } from "../validate";
import { buildHealth } from "./admin-system";
import { prepareSettings } from "./admin-settings-prepare";

// 系统设置分组 API（03 §7）：GET 读一组，PUT 整组替换（缺字段或多字段都是 400）。
// 每组独立 zod 校验；写审计 settings.update，detail 里是 { group, changes: { 字段: { from, to } } }，
// Turnstile secret 不入审计也不回显（GET 只有 secret_set）。system 组只读。
// 管理员鉴权由 index.ts 对 /api/admin/* 统一挂载的 requireAdmin 保证。

export const adminSettingsRoutes = new Hono<AppEnv>();

/** PUT 的请求体 schema；turnstile 多一个可选的 secret */
const INPUT_SCHEMAS: Record<WritableSettingGroup, z.ZodType<Record<string, unknown>>> = {
  site: siteSettingsSchema,
  appearance: appearanceSettingsSchema,
  auth: authSettingsSchema,
  turnstile: turnstileSettingsInputSchema,
  security: securitySettingsSchema,
  links: linksSettingsSchema,
  logs: logsSettingsSchema,
};

function parseGroup(c: Context<AppEnv>): SettingGroup {
  const parsed = settingGroupSchema.safeParse(c.req.param("group"));
  if (!parsed.success) throw notFoundError("设置分组不存在");
  return parsed.data;
}

async function readSystem(env: AppEnv["Bindings"]): Promise<SystemSettings> {
  const health = await buildHealth(env);
  return {
    ...health,
    db_version: health.mail_db.probe?.db_version ?? null,
    mail_index_rows: health.app_db.ok ? await countMailIndexRows(env.APP_DB) : 0,
  };
}

async function readGroup(env: AppEnv["Bindings"], group: WritableSettingGroup): Promise<Record<string, unknown>> {
  if (group === "turnstile") return { ...toTurnstileSettings(await loadTurnstileConfig(env.APP_DB)) };
  return readGroupFields(env.APP_DB, group);
}

adminSettingsRoutes.get("/:group", async (c) => {
  const group = parseGroup(c);
  if (group === "system") return c.json(await readSystem(c.env));
  return c.json(await readGroup(c.env, group));
});

adminSettingsRoutes.put("/:group", async (c) => {
  const group = parseGroup(c);
  if (group === "system") throw new ApiError(HTTP_METHOD_NOT_ALLOWED, "group_read_only", "系统状态是只读的");

  const input = await parseJsonBody(c, INPUT_SCHEMAS[group]);
  const before = await readGroup(c.env, group);
  const prepared = await prepareSettings(c.env, group, input);
  const actorId = c.var.auth.user.id;
  await writeGroupFields(c.env.APP_DB, group, prepared.values, actorId, prepared.extra);

  const after = await readGroup(c.env, group);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.settingsUpdate,
    actorUserId: actorId,
    targetType: "settings",
    targetId: group,
    detail: { group, changes: diffSettings(before, after), ...prepared.auditNote },
  });
  return c.json(after);
});
