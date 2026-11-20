import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { reauthRequestSchema, totpEnableRequestSchema } from "@maillink/shared";
import type { OkResponse, RecoveryCodesResponse, TotpSetupResponse } from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { FLOW_COOKIES, clearFlowCookie, readFlowCookie, setFlowCookie } from "../auth/flow-cookies";
import { newJti } from "../auth/mfa";
import { reauthenticate } from "../auth/reauth";
import { createRecoveryCodeHasher, generateRecoveryCodes } from "../auth/recovery-codes";
import { FlowTokenError, decryptToken, encryptToken } from "../auth/signed-token";
import { base32Decode, base32Encode, matchTotp, otpauthUri } from "../auth/totp";
import { encryptTotpSecret } from "../auth/totp-service";
import { randomBytes } from "../auth/crypto";
import { nowSec } from "../clock";
import { TOTP_ISSUER_MAX_LENGTH, TOTP_SECRET_BYTES, TOTP_SETUP_SEC } from "../constants";
import { deleteUserSessions } from "../db/sessions";
import { getSettings } from "../db/settings";
import { disableTotp, enableTotpWithRecoveryCodes, replaceRecoveryCodes } from "../db/totp";
import { findUserById } from "../db/users";
import type { UserRow } from "../db/users";
import type { AppEnv } from "../env";
import { ApiError, notFoundError } from "../errors";
import { HTTP_BAD_REQUEST, HTTP_CONFLICT } from "../http-status";
import { parseJsonBody } from "../validate";

// /api/me/totp 与 /api/me/recovery-codes（03 §4.2）。
// 启用流程：setup 只生成密钥并放进加密 Cookie（不落库）→ enable 提交一次验证码确认后才写库。
// 启用、关闭 2FA 都会让该用户的其他会话失效（03 §3）。

export const meTotpRoutes = new Hono<AppEnv>();

const SETUP_TYP = "totp_setup";
const setupTokenSchema = z.object({
  typ: z.literal(SETUP_TYP),
  exp: z.number().int(),
  jti: z.string().min(1),
  uid: z.number().int().positive(),
  sec: z.string().min(1),
});

async function currentUser(c: Context<AppEnv>): Promise<UserRow> {
  const user = await findUserById(c.env.APP_DB, c.var.auth.user.id);
  if (!user) throw notFoundError("用户不存在");
  return user;
}

function totpAlreadyEnabled(): ApiError {
  return new ApiError(HTTP_CONFLICT, "totp_already_enabled", "两步验证已启用");
}

function totpNotEnabled(): ApiError {
  return new ApiError(HTTP_CONFLICT, "totp_not_enabled", "尚未启用两步验证");
}

/** 生成恢复码明文与库内摘要 */
async function newRecoveryCodes(c: Context<AppEnv>): Promise<{ codes: string[]; hashes: string[] }> {
  const codes = generateRecoveryCodes();
  const hash = await createRecoveryCodeHasher(c.env);
  return { codes, hashes: await Promise.all(codes.map((code) => hash(code.replaceAll("-", "")))) };
}

/** 关闭 2FA 与重新生成恢复码：必须提供当前密码或 TOTP */
async function reauthWithFactor(c: Context<AppEnv>, user: UserRow, purpose: string): Promise<void> {
  await reauthenticate(c, user, await parseJsonBody(c, reauthRequestSchema), { purpose, allowRecentSession: false });
}

meTotpRoutes.post("/totp/setup", async (c) => {
  const user = await currentUser(c);
  if (user.totp_enabled_at !== null) throw totpAlreadyEnabled();

  const secret = base32Encode(randomBytes(TOTP_SECRET_BYTES));
  const exp = nowSec() + TOTP_SETUP_SEC;
  const token = await encryptToken(c.env, { typ: SETUP_TYP, exp, jti: newJti(), uid: user.id, sec: secret });
  setFlowCookie(c, FLOW_COOKIES.totpSetup, token);

  const { "site.name": siteName } = await getSettings(c.env.APP_DB, ["site.name"]);
  const response: TotpSetupResponse = {
    secret,
    otpauth_uri: otpauthUri(siteName.slice(0, TOTP_ISSUER_MAX_LENGTH), user.username, secret),
    expires_at: exp,
  };
  return c.json(response);
});

async function readSetupSecret(c: Context<AppEnv>, userId: number): Promise<string> {
  const invalid = new ApiError(HTTP_BAD_REQUEST, "totp_setup_expired", "设置已过期，请重新开始");
  const token = readFlowCookie(c, FLOW_COOKIES.totpSetup);
  if (!token) throw invalid;
  try {
    const payload = await decryptToken(c.env, token, SETUP_TYP, setupTokenSchema, nowSec());
    if (payload.uid !== userId) throw invalid;
    return payload.sec;
  } catch (error) {
    if (error instanceof FlowTokenError) throw invalid;
    throw error;
  }
}

meTotpRoutes.post("/totp/enable", async (c) => {
  const db = c.env.APP_DB;
  const { auth } = c.var;
  const body = await parseJsonBody(c, totpEnableRequestSchema);
  const user = await currentUser(c);
  if (user.totp_enabled_at !== null) throw totpAlreadyEnabled();

  // 拿到别人会话的人不能直接启用 2FA 把原用户锁在外面：先再确认身份
  await reauthenticate(c, user, { password: body.password }, { purpose: "totp_enable", allowRecentSession: true });

  const secret = await readSetupSecret(c, user.id);
  const now = nowSec();
  const step = await matchTotp(base32Decode(secret), body.code, now);
  if (step === null) throw new ApiError(HTTP_BAD_REQUEST, "invalid_totp_code", "验证码错误");

  const secretEnc = await encryptTotpSecret(c.env, user.id, secret);
  const { codes, hashes } = await newRecoveryCodes(c);
  const enabled = await enableTotpWithRecoveryCodes(db, user.id, { secretEnc, usedStep: step, recoveryHashes: hashes }, now);
  if (!enabled) throw totpAlreadyEnabled();
  clearFlowCookie(c, FLOW_COOKIES.totpSetup);
  const revoked = await deleteUserSessions(db, user.id, auth.session.idHash);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.totpEnable,
    actorUserId: user.id,
    targetType: "user",
    targetId: user.id,
    detail: { sessions_revoked: revoked },
  });
  const response: RecoveryCodesResponse = { recovery_codes: codes };
  return c.json(response);
});

meTotpRoutes.delete("/totp", async (c) => {
  const db = c.env.APP_DB;
  const { auth } = c.var;
  const user = await currentUser(c);
  if (user.totp_enabled_at === null) throw totpNotEnabled();
  await reauthWithFactor(c, user, "totp_disable");

  if (!(await disableTotp(db, user.id, nowSec()))) throw totpNotEnabled();
  const revoked = await deleteUserSessions(db, user.id, auth.session.idHash);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.totpDisable,
    actorUserId: user.id,
    targetType: "user",
    targetId: user.id,
    detail: { sessions_revoked: revoked },
  });
  const response: OkResponse = { status: "ok" };
  return c.json(response);
});

meTotpRoutes.post("/recovery-codes", async (c) => {
  const user = await currentUser(c);
  if (user.totp_enabled_at === null) throw totpNotEnabled();
  await reauthWithFactor(c, user, "recovery_codes");

  const { codes, hashes } = await newRecoveryCodes(c);
  await replaceRecoveryCodes(c.env.APP_DB, user.id, hashes);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.recoveryCodesRegenerate,
    actorUserId: user.id,
    targetType: "user",
    targetId: user.id,
  });
  const response: RecoveryCodesResponse = { recovery_codes: codes };
  return c.json(response);
});
