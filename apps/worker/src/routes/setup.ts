import { Hono } from "hono";
import { setupRequestSchema } from "@maillink/shared";
import type { OkResponse, SetupStatus } from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { timingSafeEqualStrings } from "../auth/crypto";
import { hashPassword } from "../auth/password";
import { nowSec } from "../clock";
import { insertFirstAdminWithTemplates } from "../db/setup";
import { countUsers } from "../db/users";
import type { AppEnv } from "../env";
import { ApiError, notFoundError } from "../errors";
import { parseJsonBody } from "../validate";
import { HTTP_CREATED, HTTP_FORBIDDEN, HTTP_SERVICE_UNAVAILABLE } from "../http-status";

export const setupRoutes = new Hono<AppEnv>();

setupRoutes.get("/status", async (c) => {
  const body: SetupStatus = { needs_setup: (await countUsers(c.env.APP_DB)) === 0 };
  return c.json(body);
});

setupRoutes.post("/", async (c) => {
  const db = c.env.APP_DB;
  // 已有用户后永久 404，不区分任何原因（03 §2）
  if ((await countUsers(db)) > 0) throw notFoundError();

  const body = await parseJsonBody(c, setupRequestSchema);
  const expectedToken = c.env.SETUP_TOKEN;
  if (!expectedToken) {
    throw new ApiError(HTTP_SERVICE_UNAVAILABLE, "setup_token_not_configured", "服务端未配置 SETUP_TOKEN，无法初始化");
  }
  if (!(await timingSafeEqualStrings(body.setup_token, expectedToken))) {
    throw new ApiError(HTTP_FORBIDDEN, "invalid_setup_token", "初始化令牌错误");
  }

  const passwordHash = await hashPassword(c.env, body.password);
  const adminId = await insertFirstAdminWithTemplates(db, { username: body.username, password_hash: passwordHash }, nowSec());
  // 校验之后、写入之前被并发的初始化抢先：同样视为"已初始化"
  if (adminId === null) throw notFoundError();

  // 内置规则组模板已与管理员同一个 batch 写入。默认设置不落库，读取时取 db/settings.ts 里的默认值。
  await recordAudit(c, {
    action: AUDIT_ACTIONS.setupComplete,
    actorUserId: adminId,
    targetType: "user",
    targetId: adminId,
    detail: { username: body.username },
  });
  const response: OkResponse = { status: "ok" };
  return c.json(response, HTTP_CREATED);
});
