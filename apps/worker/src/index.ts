import { Hono } from "hono";
import type { AppEnv } from "./env";
import { requireAdmin } from "./middleware/auth";
import { csrfProtection } from "./middleware/csrf";
import { notFound, onError } from "./middleware/error";
import { rateLimitByIp, rateLimitLogin } from "./middleware/rate-limit";
import { runScheduled } from "./cron";
import { RATE_LIMITED_ROUTES } from "./constants";
import { adminAuditRoutes } from "./routes/admin-audit";
import { adminMailboxRoutes } from "./routes/admin-mailboxes";
import { adminMailRoutes } from "./routes/admin-mails";
import { adminOAuthProviderRoutes } from "./routes/admin-oauth-providers";
import { adminRuleGroupRoutes } from "./routes/admin-rule-groups";
import { adminSettingsRoutes } from "./routes/admin-settings";
import { adminSystemRoutes } from "./routes/admin-system";
import { adminUserRoutes } from "./routes/admin-users";
import { authRoutes } from "./routes/auth";
import { meRoutes } from "./routes/me";
import { publicRoutes } from "./routes/public";
import { setupRoutes } from "./routes/setup";

export const app = new Hono<AppEnv>();

app.onError(onError);
app.notFound(notFound);

// 写操作的 CSRF 检查对所有 /api/* 生效（04 约定）
app.use("/api/*", csrfProtection);
// 限流（01 §2）：按 constants.ts 的 RATE_LIMITED_ROUTES 清单挂在这里，不改各路由文件。必须在 csrf 之后、路由之前
for (const route of RATE_LIMITED_ROUTES) {
  app.on(route.method, route.path, route.usernameKeyed ? rateLimitLogin : rateLimitByIp(route.purpose));
}
// /api/admin/* 全部要求管理员
app.use("/api/admin/*", requireAdmin);

app.route("/api/public", publicRoutes);
app.route("/api/setup", setupRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/me", meRoutes);
app.route("/api/admin/users", adminUserRoutes);
app.route("/api/admin/system", adminSystemRoutes);
app.route("/api/admin/settings", adminSettingsRoutes);
app.route("/api/admin/mails", adminMailRoutes);
app.route("/api/admin/oauth-providers", adminOAuthProviderRoutes);
app.route("/api/admin/mailboxes", adminMailboxRoutes);
app.route("/api/admin/rule-groups", adminRuleGroupRoutes);
app.route("/api/admin/audit-logs", adminAuditRoutes);

export default {
  fetch: app.fetch,
  // 按 controller.cron 分派，见 cron/index.ts；失败会记录到 settings 后原样抛出
  async scheduled(controller: ScheduledController, env: AppEnv["Bindings"], _ctx: ExecutionContext) {
    await runScheduled(controller.cron, env);
  },
} satisfies ExportedHandler<AppEnv["Bindings"]>;
