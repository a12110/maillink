import { Hono } from "hono";
import { loginRequestSchema, mfaRecoveryRequestSchema, mfaTotpRequestSchema } from "@maillink/shared";
import type { LoginResponse, OkResponse, SessionResponse } from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { adminTwoFactorMissing } from "../auth/admin-2fa";
import { requireLoginMethod } from "../auth/login-method-gate";
import { completeSecondFactor, issuePendingAuth } from "../auth/mfa";
import { burnPasswordCheck, verifyPassword } from "../auth/password";
import { endSession, sessionLimits, startSession } from "../auth/session";
import { recoveryFactor, totpFactor } from "../auth/second-factors";
import { nowSec } from "../clock";
import { findUserByUsername, touchLastLogin } from "../db/users";
import type { UserRow } from "../db/users";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { requireUser } from "../middleware/auth";
import { enforceTurnstile } from "../turnstile/verify";
import { parseJsonBody } from "../validate";
import { HTTP_UNAUTHORIZED } from "../http-status";
import { authOAuthRoutes } from "./auth-oauth";
import { authPasskeyRoutes } from "./auth-passkey";
import { authRegisterRoutes } from "./auth-register";

type LoginFailure = "unknown_user" | "no_password" | "bad_password" | "disabled";

export const authRoutes = new Hono<AppEnv>();
authRoutes.route("/passkey", authPasskeyRoutes);
authRoutes.route("/oauth", authOAuthRoutes);
authRoutes.route("/register", authRegisterRoutes);

authRoutes.post("/login", async (c) => {
  const body = await parseJsonBody(c, loginRequestSchema);
  const db = c.env.APP_DB;
  // 设置关闭密码登录时直接拒绝；人机验证在哈希计算之前，机器人不会消耗 CPU
  await requireLoginMethod(db, "password");
  await enforceTurnstile(c, "login", body.turnstile_token);
  const user = await findUserByUsername(db, body.username);

  // 无论用户是否存在都做一次等量的哈希计算，响应耗时不泄露用户名是否存在
  const passwordOk = user?.password_hash
    ? await verifyPassword(c.env, body.password, user.password_hash)
    : await burnPasswordCheck(c.env, body.password);

  const verdict = judgeLogin(user, passwordOk);
  if ("reason" in verdict) {
    await recordAudit(c, {
      action: AUDIT_ACTIONS.loginFailed,
      actorUserId: null,
      ...(user ? { targetType: "user" as const, targetId: user.id } : {}),
      detail: { username: body.username, reason: verdict.reason },
    });
    // 对外统一：不区分用户不存在、密码错误、账号被禁用
    throw new ApiError(HTTP_UNAUTHORIZED, "invalid_credentials", "用户名或密码错误");
  }

  // 已启用 2FA：不发会话，改发 pending_auth（03 §4.2）
  if (verdict.user.totp_enabled_at !== null) {
    return c.json(await issuePendingAuth(c, verdict.user.id, ["password"]) satisfies LoginResponse);
  }

  await startSession(c, verdict.user.id, ["password"]);
  await touchLastLogin(db, verdict.user.id, nowSec());
  await recordAudit(c, {
    action: AUDIT_ACTIONS.loginSuccess,
    actorUserId: verdict.user.id,
    targetType: "user",
    targetId: verdict.user.id,
    detail: { method: "password" },
  });
  const response: LoginResponse = { status: "ok" };
  return c.json(response);
});

/** 失败原因只进审计，不返回给客户端 */
function judgeLogin(user: UserRow | null, passwordOk: boolean): { user: UserRow } | { reason: LoginFailure } {
  if (user === null) return { reason: "unknown_user" };
  if (!user.password_hash) return { reason: "no_password" };
  if (!passwordOk) return { reason: "bad_password" };
  if (user.status !== "active") return { reason: "disabled" };
  return { user };
}

authRoutes.post("/mfa/totp", async (c) => {
  const body = await parseJsonBody(c, mfaTotpRequestSchema);
  await completeSecondFactor(c, "totp", totpFactor(c.env, body.code, nowSec()));
  const response: OkResponse = { status: "ok" };
  return c.json(response);
});

authRoutes.post("/mfa/recovery", async (c) => {
  const body = await parseJsonBody(c, mfaRecoveryRequestSchema);
  await completeSecondFactor(c, "recovery", recoveryFactor(c.env, body.code, nowSec()));
  const response: OkResponse = { status: "ok" };
  return c.json(response);
});

authRoutes.post("/logout", async (c) => {
  await endSession(c);
  const response: OkResponse = { status: "ok" };
  return c.json(response);
});

authRoutes.get("/session", requireUser, async (c) => {
  const { user, session } = c.var.auth;
  const response: SessionResponse = {
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      email: user.email,
      role: user.role,
    },
    auth_methods: session.authMethods,
    // 管理员缩短绝对时长后，已有会话实际到期时间以"创建时间 + 当前设置"为准（与 sessionExpired 一致）
    expires_at: Math.min(session.expiresAt, session.createdAt + (await sessionLimits(c.env.APP_DB)).absoluteSec),
    admin_2fa_required: await adminTwoFactorMissing(c.env.APP_DB, c.var.auth),
  };
  return c.json(response);
});
