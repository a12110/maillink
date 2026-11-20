import { Hono } from "hono";
import type { HealthResponse, MailSchemaProbe } from "@maillink/shared";
import type { AppEnv, Bindings } from "../env";
import { getLastRun } from "../db/cron-state";
import { getMailSchema } from "../mail-source";
import type { MailDbBinding } from "../mail-source";
import { HTTP_OK, HTTP_SERVICE_UNAVAILABLE } from "../http-status";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkAppDb(db: D1Database): Promise<HealthResponse["app_db"]> {
  try {
    await db.prepare("SELECT 1").first();
    return { ok: true, error: null };
  } catch (error) {
    console.error("health check: APP_DB 查询失败", error);
    return { ok: false, error: describeError(error) };
  }
}

/** probeMail：调用方把 MAIL_DB 直接交给 mail-source 的探测函数（MAIL_DB 不经过本文件的其他函数） */
async function checkMailDb(probeMail: () => Promise<MailSchemaProbe>): Promise<HealthResponse["mail_db"]> {
  let probe: MailSchemaProbe;
  try {
    probe = await probeMail();
  } catch (error) {
    console.error("health check: MAIL_DB 探测失败", error);
    return { ok: false, error: describeError(error), probe: null };
  }
  return {
    ok: probe.healthy,
    error: probe.healthy ? null : "MAIL_DB 缺少必需的表或列，见 probe.missing_required",
    probe,
  };
}

/** 健康检查：两个库的探测、限流绑定状态与 cron 上次运行。health 接口与系统设置的"系统状态"共用 */
export async function buildHealth(env: Pick<Bindings, "APP_DB" | "RATE_LIMITER" | "LINK_RATE_LIMITER"> & MailDbBinding): Promise<HealthResponse> {
  // 健康检查总是重探并刷新缓存（01 §3.1）
  const [appDb, mailDb] = await Promise.all([checkAppDb(env.APP_DB), checkMailDb(() => getMailSchema(env.MAIL_DB, { refresh: true }))]);
  // ok 只反映两个库；cron 失败与限流未配置作为状态字段展示，由管理员处理
  const cron = appDb.ok
    ? { prewarm: await getLastRun(env.APP_DB, "prewarm"), cleanup: await getLastRun(env.APP_DB, "cleanup") }
    : { prewarm: null, cleanup: null };
  return {
    ok: appDb.ok && mailDb.ok,
    app_db: appDb,
    mail_db: mailDb,
    rate_limit: {
      configured: env.RATE_LIMITER !== undefined,
      link_configured: env.LINK_RATE_LIMITER !== undefined,
    },
    cron,
  };
}

export const adminSystemRoutes = new Hono<AppEnv>();

// 管理员鉴权由 index.ts 对 /api/admin/* 统一挂载的 requireAdmin 保证
adminSystemRoutes.get("/health", async (c) => {
  const body = await buildHealth(c.env);
  // 不健康时返回 503，让监控与前端都能直接感知；响应体结构不变
  return c.json(body, body.ok ? HTTP_OK : HTTP_SERVICE_UNAVAILABLE);
});
