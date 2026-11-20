import { Hono } from "hono";
import { registerRequestSchema } from "@maillink/shared";
import type { OkResponse } from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { requireLoginMethod } from "../auth/login-method-gate";
import { hashPassword } from "../auth/password";
import { assertPasswordPolicy } from "../auth/password-policy";
import { startSession } from "../auth/session";
import { nowSec } from "../clock";
import { getSettings } from "../db/settings";
import { insertUser, touchLastLogin } from "../db/users";
import type { AppEnv } from "../env";
import { notFoundError } from "../errors";
import { HTTP_CREATED } from "../http-status";
import { enforceTurnstile } from "../turnstile/verify";
import { parseJsonBody } from "../validate";
import { mapUserConflicts } from "./user-conflicts";

// 注册（03 §5）：开关在系统设置里，默认关闭，关闭时 404（不暴露该接口存在）。
// 只要用户名和密码，邮箱可选且不验证（本系统没有发信能力），邮箱不标记为"管理员设置"，不参与 OAuth 自动关联。
// 角色固定 user，没有任何授权。成功后直接登录（发会话），省一次往返；新账号没有 TOTP，不需要第二步。
// 注册产生的是密码账号，所以"密码登录"被设置关闭时一并拒绝（否则会建出无法登录的账号）。

export const authRegisterRoutes = new Hono<AppEnv>();

authRegisterRoutes.post("/", async (c) => {
  const db = c.env.APP_DB;
  const { "registration.enabled": open } = await getSettings(db, ["registration.enabled"]);
  if (!open) throw notFoundError();

  const body = await parseJsonBody(c, registerRequestSchema);
  await requireLoginMethod(db, "password");
  await enforceTurnstile(c, "register", body.turnstile_token);
  await assertPasswordPolicy(db, body.password);

  const now = nowSec();
  const id = await mapUserConflicts(
    insertUser(
      db,
      {
        username: body.username,
        display_name: null,
        email: body.email ?? null,
        role: "user",
        status: "active",
        password_hash: await hashPassword(c.env, body.password),
      },
      now,
    ),
  );
  await recordAudit(c, {
    action: AUDIT_ACTIONS.userRegister,
    actorUserId: id,
    targetType: "user",
    targetId: id,
    detail: { username: body.username },
  });

  await startSession(c, id, ["password"]);
  await touchLastLogin(db, id, now);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.loginSuccess,
    actorUserId: id,
    targetType: "user",
    targetId: id,
    detail: { method: "password", via: "register" },
  });
  const response: OkResponse = { status: "ok" };
  return c.json(response, HTTP_CREATED);
});
