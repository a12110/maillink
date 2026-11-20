import { Hono } from "hono";
import { auditLogListQuerySchema } from "@maillink/shared";
import { listAuditLogs } from "../db/audit-list";
import type { AppEnv } from "../env";
import { parseQuery } from "../validate";

// 审计日志（只读）。鉴权由 index.ts 对 /api/admin/* 统一挂载的 requireAdmin 保证。

export const adminAuditRoutes = new Hono<AppEnv>();

// 日志含 IP 与账号信息，响应一律不缓存
adminAuditRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

adminAuditRoutes.get("/", async (c) => {
  return c.json(await listAuditLogs(c.env.APP_DB, parseQuery(c, auditLogListQuerySchema)));
});
