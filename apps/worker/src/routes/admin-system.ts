import { Hono } from "hono";
import type { HealthResponse, MailSchemaProbe } from "@maillink/shared";
import type { AppEnv } from "../env";
import { getMailSchema } from "../mail-source";

const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkAppDb(db: D1Database): Promise<HealthResponse["app_db"]> {
  try {
    await db.prepare("SELECT 1").first();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

async function checkMailDb(db: D1Database): Promise<HealthResponse["mail_db"]> {
  let probe: MailSchemaProbe;
  try {
    // 健康检查总是重探并刷新缓存（01 §3.1）
    probe = await getMailSchema(db, { refresh: true });
  } catch (error) {
    return { ok: false, error: describeError(error), probe: null };
  }
  return {
    ok: probe.healthy,
    error: probe.healthy ? null : "MAIL_DB 缺少必需的表或列，见 probe.missing_required",
    probe,
  };
}

export const adminSystemRoutes = new Hono<AppEnv>();

// TODO(M1): 加管理员鉴权。本里程碑尚无登录，此接口暂时公开，部署前必须先完成 M1。
adminSystemRoutes.get("/health", async (c) => {
  const [appDb, mailDb] = await Promise.all([checkAppDb(c.env.APP_DB), checkMailDb(c.env.MAIL_DB)]);
  const body: HealthResponse = { ok: appDb.ok && mailDb.ok, app_db: appDb, mail_db: mailDb };
  // 不健康时返回 503，让监控与前端都能直接感知；响应体结构不变
  return c.json(body, body.ok ? HTTP_OK : HTTP_SERVICE_UNAVAILABLE);
});
