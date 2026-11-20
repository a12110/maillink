import { Hono } from "hono";
import { z } from "zod";
import { changePasswordRequestSchema, revokeSessionsQuerySchema, updateMeRequestSchema } from "@maillink/shared";
import type { MeResponse, MySession, OkResponse, SessionsRevokedResponse } from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../auth/password";
import { assertPasswordPolicy } from "../auth/password-policy";
import { createSessionPublicIdMaker } from "../auth/session-public-id";
import { nowSec } from "../clock";
import { PUBLIC_SESSION_ID_MAX_LENGTH } from "../constants";
import { deleteSession, deleteUserSessions, listUserSessions } from "../db/sessions";
import { countUnusedRecoveryCodes } from "../db/totp";
import { findUserById, setPasswordHash, updateUser } from "../db/users";
import type { UserRow } from "../db/users";
import type { AppEnv } from "../env";
import { ApiError, notFoundError } from "../errors";
import { requireUser } from "../middleware/auth";
import { parseJsonBody, parseQuery, parseWith } from "../validate";
import { mapUserConflicts } from "./user-conflicts";
import { HTTP_BAD_REQUEST } from "../http-status";
import { meIdentityRoutes } from "./me-identities";
import { mePasskeyRoutes } from "./me-passkeys";
import { meTotpRoutes } from "./me-totp";

export const meRoutes = new Hono<AppEnv>();
meRoutes.use("*", requireUser);
meRoutes.route("/", meTotpRoutes);
meRoutes.route("/passkeys", mePasskeyRoutes);
meRoutes.route("/identities", meIdentityRoutes);

async function toMeResponse(db: D1Database, user: UserRow): Promise<MeResponse> {
  const totpEnabled = user.totp_enabled_at !== null;
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    email: user.email_lc,
    role: user.role,
    has_password: user.password_hash !== null,
    totp_enabled: totpEnabled,
    recovery_codes_remaining: totpEnabled ? await countUnusedRecoveryCodes(db, user.id) : 0,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
  };
}

/** 会话有效但用户行不存在只可能是并发删除，按 404 处理 */
async function loadCurrentUser(db: D1Database, id: number): Promise<UserRow> {
  const user = await findUserById(db, id);
  if (!user) throw notFoundError("用户不存在");
  return user;
}

meRoutes.get("/", async (c) => {
  const db = c.env.APP_DB;
  return c.json(await toMeResponse(db, await loadCurrentUser(db, c.var.auth.user.id)));
});

meRoutes.patch("/", async (c) => {
  const db = c.env.APP_DB;
  const { id } = c.var.auth.user;
  const body = await parseJsonBody(c, updateMeRequestSchema);
  const before = await loadCurrentUser(db, id);
  // 用户自己改邮箱会清掉"管理员设置"标记；提交的邮箱与现有相同时不算修改，标记保持不变
  const { email, ...rest } = body;
  const patch = email === undefined || email === before.email_lc ? rest : { ...rest, email, email_admin_set: false };
  if (Object.keys(patch).length > 0) {
    const updated = await mapUserConflicts(updateUser(db, id, patch, nowSec()));
    if (!updated) throw notFoundError("用户不存在");
  }
  return c.json(await toMeResponse(db, await loadCurrentUser(db, id)));
});

meRoutes.post("/password", async (c) => {
  const db = c.env.APP_DB;
  const { auth } = c.var;
  const body = await parseJsonBody(c, changePasswordRequestSchema);
  const user = await loadCurrentUser(db, auth.user.id);

  const currentOk = user.password_hash
    ? await verifyPassword(c.env, body.current_password, user.password_hash)
    : await burnPasswordCheck(c.env, body.current_password);
  if (!currentOk) {
    throw new ApiError(HTTP_BAD_REQUEST, "invalid_current_password", "当前密码错误");
  }

  await assertPasswordPolicy(db, body.new_password);
  await setPasswordHash(db, user.id, await hashPassword(c.env, body.new_password), nowSec());
  // 改密码后其他会话全部失效，保留当前会话（03 §3）
  const revoked = await deleteUserSessions(db, user.id, auth.session.idHash);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.passwordChange,
    actorUserId: user.id,
    targetType: "user",
    targetId: user.id,
    detail: { revoked_sessions: revoked },
  });
  const response: OkResponse = { status: "ok" };
  return c.json(response);
});

meRoutes.get("/sessions", async (c) => {
  const { auth } = c.var;
  const publicId = await createSessionPublicIdMaker(c.env);
  const rows = await listUserSessions(c.env.APP_DB, auth.user.id);
  const items: MySession[] = await Promise.all(
    rows.map(async (row) => ({
      id: await publicId(row.id_hash),
      current: row.id_hash === auth.session.idHash,
      auth_methods: row.auth_methods === "" ? [] : row.auth_methods.split(","),
      created_at: row.created_at,
      last_seen_at: row.last_seen_at,
      expires_at: row.expires_at,
      ip: row.ip,
      user_agent: row.user_agent,
    })),
  );
  return c.json({ items });
});

/** 一次注销"我的其他会话"；scope 目前只支持 others，当前会话请用退出登录 */
meRoutes.delete("/sessions", async (c) => {
  const { auth } = c.var;
  parseQuery(c, revokeSessionsQuerySchema);
  const revoked = await deleteUserSessions(c.env.APP_DB, auth.user.id, auth.session.idHash);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.sessionsRevokeOthers,
    actorUserId: auth.user.id,
    targetType: "user",
    targetId: auth.user.id,
    detail: { revoked },
  });
  const response: SessionsRevokedResponse = { status: "ok", revoked };
  return c.json(response);
});

meRoutes.delete("/sessions/:id", async (c) => {
  const { auth } = c.var;
  const db = c.env.APP_DB;
  const requestedId = parseWith(z.string().min(1).max(PUBLIC_SESSION_ID_MAX_LENGTH), c.req.param("id"));

  // 短 id 只在当前用户自己的会话里解析，别人的会话即使 id 泄露也删不到
  const publicId = await createSessionPublicIdMaker(c.env);
  const rows = await listUserSessions(db, auth.user.id);
  const publicIds = await Promise.all(rows.map((row) => publicId(row.id_hash)));
  const index = publicIds.indexOf(requestedId);
  const target = rows[index];
  if (index === -1 || !target) throw notFoundError("会话不存在");

  if (target.id_hash === auth.session.idHash) {
    throw new ApiError(HTTP_BAD_REQUEST, "cannot_revoke_current_session", "不能注销当前会话，请使用退出登录");
  }
  await deleteSession(db, target.id_hash);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.sessionRevoke,
    actorUserId: auth.user.id,
    targetType: "session",
    targetId: requestedId,
  });
  const response: OkResponse = { status: "ok" };
  return c.json(response);
});
