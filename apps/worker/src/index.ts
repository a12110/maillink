import { Hono } from "hono";
import type { AppEnv } from "./env";
import { requireAdmin } from "./middleware/auth";
import { csrfProtection } from "./middleware/csrf";
import { notFound, onError } from "./middleware/error";
import { adminMailRoutes } from "./routes/admin-mails";
import { adminOAuthProviderRoutes } from "./routes/admin-oauth-providers";
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
// /api/admin/* 全部要求管理员
app.use("/api/admin/*", requireAdmin);

app.route("/api/public", publicRoutes);
app.route("/api/setup", setupRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/me", meRoutes);
app.route("/api/admin/users", adminUserRoutes);
app.route("/api/admin/system", adminSystemRoutes);
app.route("/api/admin/mails", adminMailRoutes);
app.route("/api/admin/oauth-providers", adminOAuthProviderRoutes);

export default {
  fetch: app.fetch,
  // TODO(M2/M7): 填充 cron 任务。
  //   "*/5 * * * *"  预热 mail_index（已导入地址的新邮件）
  //   "17 3 * * *"   清理过期会话、过期日志、MAIL_DB 中已不存在的索引行
  // 本里程碑刻意留空：不做任何事，也不假装成功。
  async scheduled(_controller: ScheduledController, _env: AppEnv["Bindings"], _ctx: ExecutionContext) {},
} satisfies ExportedHandler<AppEnv["Bindings"]>;
