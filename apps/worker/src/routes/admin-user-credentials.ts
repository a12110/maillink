import { Hono } from "hono";
import type { Context } from "hono";
import type { CredentialRemovalResponse } from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import type { AuditAction } from "../audit";
import { nowSec } from "../clock";
import { deleteIdentitiesByAdmin } from "../db/identities";
import { hasAnyLoginMethod } from "../db/login-methods";
import { deletePasskeysByAdmin } from "../db/passkeys";
import { deleteUserSessions } from "../db/sessions";
import { disableTotp } from "../db/totp";
import { findUserById } from "../db/users";
import type { AppEnv } from "../env";
import { notFoundError } from "../errors";
import { parseIdParam } from "../validate";

// 管理员清除用户的凭据（03 §6）：两步验证、通行密钥（单把或全部）、OAuth 绑定（单个或全部）。
// 管理员操作不做"至少保留一种登录方式"保护，但响应里用 no_login_method 提示需要给该用户设置密码。
// 确实清掉了东西时，该用户的会话全部失效（管理员清自己时保留当前会话，03 §3）。全部写审计。

export const adminUserCredentialRoutes = new Hono<AppEnv>();

type Removal = { action: AuditAction; kind: "totp" | "passkey" | "identity"; itemId?: number };

async function finishRemoval(c: Context<AppEnv>, userId: number, removed: number, removal: Removal): Promise<Response> {
  const db = c.env.APP_DB;
  const { auth } = c.var;
  const keep = auth.user.id === userId ? auth.session.idHash : undefined;
  const sessionsRevoked = removed > 0 ? await deleteUserSessions(db, userId, keep) : 0;
  const noLoginMethod = !(await hasAnyLoginMethod(db, userId));
  await recordAudit(c, {
    action: removal.action,
    actorUserId: auth.user.id,
    targetType: "user",
    targetId: userId,
    detail: {
      ...(removal.itemId === undefined ? { scope: "all" } : { [`${removal.kind}_id`]: removal.itemId }),
      removed,
      sessions_revoked: sessionsRevoked,
      no_login_method: noLoginMethod,
    },
  });
  const response: CredentialRemovalResponse = {
    status: "ok",
    removed,
    sessions_revoked: sessionsRevoked,
    no_login_method: noLoginMethod,
  };
  return c.json(response);
}

async function requireTargetUser(c: Context<AppEnv>): Promise<number> {
  const id = parseIdParam(c);
  if (!(await findUserById(c.env.APP_DB, id))) throw notFoundError("用户不存在");
  return id;
}

adminUserCredentialRoutes.delete("/:id/totp", async (c) => {
  const userId = await requireTargetUser(c);
  const removed = (await disableTotp(c.env.APP_DB, userId, nowSec())) ? 1 : 0;
  return finishRemoval(c, userId, removed, { action: AUDIT_ACTIONS.userTotpClear, kind: "totp" });
});

adminUserCredentialRoutes.delete("/:id/passkeys", async (c) => {
  const userId = await requireTargetUser(c);
  const removed = await deletePasskeysByAdmin(c.env.APP_DB, userId);
  return finishRemoval(c, userId, removed, { action: AUDIT_ACTIONS.userPasskeysRemove, kind: "passkey" });
});

adminUserCredentialRoutes.delete("/:id/passkeys/:pid", async (c) => {
  const userId = await requireTargetUser(c);
  const passkeyId = parseIdParam(c, "pid");
  const removed = await deletePasskeysByAdmin(c.env.APP_DB, userId, passkeyId);
  if (removed === 0) throw notFoundError("通行密钥不存在");
  return finishRemoval(c, userId, removed, { action: AUDIT_ACTIONS.userPasskeysRemove, kind: "passkey", itemId: passkeyId });
});

adminUserCredentialRoutes.delete("/:id/identities", async (c) => {
  const userId = await requireTargetUser(c);
  const removed = await deleteIdentitiesByAdmin(c.env.APP_DB, userId);
  return finishRemoval(c, userId, removed, { action: AUDIT_ACTIONS.userIdentitiesRemove, kind: "identity" });
});

adminUserCredentialRoutes.delete("/:id/identities/:iid", async (c) => {
  const userId = await requireTargetUser(c);
  const identityId = parseIdParam(c, "iid");
  const removed = await deleteIdentitiesByAdmin(c.env.APP_DB, userId, identityId);
  if (removed === 0) throw notFoundError("绑定不存在");
  return finishRemoval(c, userId, removed, {
    action: AUDIT_ACTIONS.userIdentitiesRemove,
    kind: "identity",
    itemId: identityId,
  });
});
