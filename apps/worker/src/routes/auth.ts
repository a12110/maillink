import { Hono } from "hono";
import { loginRequestSchema, mfaRecoveryRequestSchema, mfaTotpRequestSchema } from "@maillink/shared";
import type { LoginResponse, OkResponse, SessionResponse } from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { completeSecondFactor, issuePendingAuth } from "../auth/mfa";
import { burnPasswordCheck, verifyPassword } from "../auth/password";
import { endSession, startSession } from "../auth/session";
import { recoveryFactor, totpFactor } from "../auth/second-factors";
import { nowSec } from "../clock";
import { findUserByUsername, touchLastLogin } from "../db/users";
import type { UserRow } from "../db/users";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { requireUser } from "../middleware/auth";
import { parseJsonBody } from "../validate";
import { HTTP_UNAUTHORIZED } from "../http-status";
import { authOAuthRoutes } from "./auth-oauth";
import { authPasskeyRoutes } from "./auth-passkey";

type LoginFailure = "unknown_user" | "no_password" | "bad_password" | "disabled";

export const authRoutes = new Hono<AppEnv>();
authRoutes.route("/passkey", authPasskeyRoutes);
authRoutes.route("/oauth", authOAuthRoutes);

authRoutes.post("/login", async (c) => {
  const body = await parseJsonBody(c, loginRequestSchema);
  // TODO(M7): 按 IP 与用户名限流（RATE_LIMITER）。M1 不做，也不做任何假限流。
  const db = c.env.APP_DB;
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

authRoutes.get("/session", requireUser, (c) => {
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
    expires_at: session.expiresAt,
  };
  return c.json(response);
});
