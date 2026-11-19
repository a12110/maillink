import { Hono } from "hono";
import type { AppEnv } from "./env";
import { notFound, onError } from "./middleware/error";
import { adminSystemRoutes } from "./routes/admin-system";

export const app = new Hono<AppEnv>();

app.onError(onError);
app.notFound(notFound);

app.route("/api/admin/system", adminSystemRoutes);

export default {
  fetch: app.fetch,
  // TODO(M2/M7): 填充 cron 任务。
  //   "*/5 * * * *"  预热 mail_index（已导入地址的新邮件）
  //   "17 3 * * *"   清理过期会话、过期日志、MAIL_DB 中已不存在的索引行
  // 本里程碑刻意留空：不做任何事，也不假装成功。
  async scheduled(_controller: ScheduledController, _env: AppEnv["Bindings"], _ctx: ExecutionContext) {},
} satisfies ExportedHandler<AppEnv["Bindings"]>;
