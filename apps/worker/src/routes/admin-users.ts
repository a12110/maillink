import { Hono } from "hono";
import {
  adminPasswordResetSchema,
  adminUserCreateSchema,
  adminUserListQuerySchema,
  adminUserPatchSchema,
} from "@maillink/shared";
import type { AdminUser, OkResponse } from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { hashPassword } from "../auth/password";
import { nowSec } from "../clock";
import { findAdminUser, listAdminUsers } from "../db/admin-users";
import { deleteUserSessions } from "../db/sessions";
import { deleteUser, findUserById, insertUser, setPasswordHash, updateUser } from "../db/users";
import type { UserPatch, UserRow } from "../db/users";
import type { AppEnv } from "../env";
import { ApiError, notFoundError } from "../errors";
import { parseIdParam, parseJsonBody, parseQuery } from "../validate";
import { mapUserConflicts } from "./user-conflicts";
import { HTTP_CONFLICT, HTTP_CREATED } from "../http-status";

export const adminUserRoutes = new Hono<AppEnv>();

function userNotFound(): ApiError {
  return notFoundError("用户不存在");
}

function lastAdminError(): ApiError {
  return new ApiError(HTTP_CONFLICT, "last_admin_protected", "不能降级、禁用或删除最后一个启用的管理员");
}

async function requireUserRow(db: D1Database, id: number): Promise<UserRow> {
  const user = await findUserById(db, id);
  if (!user) throw userNotFound();
  return user;
}

/** 改动没有落库时区分原因：用户已不存在，还是被"最后一个管理员"保护拦下 */
async function explainBlockedChange(db: D1Database, id: number): Promise<ApiError> {
  return (await findUserById(db, id)) ? lastAdminError() : userNotFound();
}

async function requireAdminUser(db: D1Database, id: number): Promise<AdminUser> {
  const user = await findAdminUser(db, id);
  if (!user) throw userNotFound();
  return user;
}

/** 只记录真正变化的字段（from → to），不含密码等秘密 */
function diffUser(before: UserRow, patch: UserPatch): Record<string, { from: unknown; to: unknown }> {
  const current: Record<keyof UserPatch, unknown> = {
    username: before.username,
    display_name: before.display_name,
    email: before.email_lc,
    role: before.role,
    status: before.status,
  };
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(current) as Array<keyof UserPatch>) {
    const next = patch[key];
    if (next !== undefined && next !== current[key]) changes[key] = { from: current[key], to: next };
  }
  return changes;
}

adminUserRoutes.get("/", async (c) => {
  return c.json(await listAdminUsers(c.env.APP_DB, parseQuery(c, adminUserListQuerySchema)));
});

adminUserRoutes.post("/", async (c) => {
  const db = c.env.APP_DB;
  const body = await parseJsonBody(c, adminUserCreateSchema);
  const passwordHash = await hashPassword(c.env, body.password);
  const id = await mapUserConflicts(
    insertUser(
      db,
      {
        username: body.username,
        display_name: body.display_name ?? null,
        email: body.email ?? null,
        role: body.role,
        status: body.status,
        password_hash: passwordHash,
      },
      nowSec(),
    ),
  );
  await recordAudit(c, {
    action: AUDIT_ACTIONS.userCreate,
    actorUserId: c.var.auth.user.id,
    targetType: "user",
    targetId: id,
    detail: { username: body.username, role: body.role, status: body.status },
  });
  return c.json(await requireAdminUser(db, id), HTTP_CREATED);
});

adminUserRoutes.get("/:id", async (c) => {
  return c.json(await requireAdminUser(c.env.APP_DB, parseIdParam(c)));
});

adminUserRoutes.patch("/:id", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const patch = await parseJsonBody(c, adminUserPatchSchema);
  const before = await requireUserRow(db, id);

  const updated = await mapUserConflicts(updateUser(db, id, patch, nowSec()));
  if (!updated) throw await explainBlockedChange(db, id);

  // 角色或状态真的变了才使会话失效（03 §3、§6）
  const changes = diffUser(before, patch);
  const sessionsRevoked = changes.role || changes.status ? await deleteUserSessions(db, id) : 0;
  await recordAudit(c, {
    action: AUDIT_ACTIONS.userUpdate,
    actorUserId: c.var.auth.user.id,
    targetType: "user",
    targetId: id,
    detail: { changes, sessions_revoked: sessionsRevoked },
  });
  return c.json(await requireAdminUser(db, id));
});

adminUserRoutes.delete("/:id", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const before = await requireUserRow(db, id);

  if (!(await deleteUser(db, id))) throw await explainBlockedChange(db, id);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.userDelete,
    actorUserId: c.var.auth.user.id,
    targetType: "user",
    targetId: id,
    // 行已删除，把关键信息留在审计里
    detail: { username: before.username, role: before.role, status: before.status },
  });
  const response: OkResponse = { status: "ok" };
  return c.json(response);
});

adminUserRoutes.post("/:id/password", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const body = await parseJsonBody(c, adminPasswordResetSchema);
  await requireUserRow(db, id);

  await setPasswordHash(db, id, await hashPassword(c.env, body.password), nowSec());
  const revoked = await deleteUserSessions(db, id);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.userPasswordReset,
    actorUserId: c.var.auth.user.id,
    targetType: "user",
    targetId: id,
    detail: { sessions_revoked: revoked },
  });
  const response: OkResponse = { status: "ok" };
  return c.json(response);
});

adminUserRoutes.delete("/:id/sessions", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  await requireUserRow(db, id);

  const revoked = await deleteUserSessions(db, id);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.userSessionsRevoke,
    actorUserId: c.var.auth.user.id,
    targetType: "user",
    targetId: id,
    detail: { sessions_revoked: revoked },
  });
  return c.json({ status: "ok" as const, revoked });
});
