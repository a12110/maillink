import { Hono } from "hono";
import type { Context } from "hono";
import { passkeyLoginVerifyRequestSchema } from "@maillink/shared";
import type { OkResponse, PasskeyLoginVerifyRequest } from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { timingSafeEqualStrings } from "../auth/crypto";
import { requireLoginMethod } from "../auth/login-method-gate";
import { consumePasskeyChallenge, issuePasskeyChallenge } from "../auth/passkey-flow";
import { startSession } from "../auth/session";
import {
  PasskeyVerificationError,
  authenticationOptions,
  encodeHandle,
  passkeyUserHandle,
  relyingParty,
  verifyAuthentication,
} from "../auth/webauthn";
import { nowSec } from "../clock";
import { findPasskeyByCredentialId, parseTransports, updatePasskeyCounter } from "../db/passkeys";
import type { PasskeyRow } from "../db/passkeys";
import { findUserById, touchLastLogin } from "../db/users";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { HTTP_UNAUTHORIZED } from "../http-status";
import { parseJsonBody } from "../validate";

// 通行密钥登录（03 §4.3）：视为已完成多因素，不再要求 TOTP；auth_methods 记 passkey。
// 失败统一 401 passkey_invalid，具体原因只进审计。

export const authPasskeyRoutes = new Hono<AppEnv>();

function passkeyInvalid(): ApiError {
  return new ApiError(HTTP_UNAUTHORIZED, "passkey_invalid", "通行密钥无效或账号不可用");
}

async function auditFailure(c: Context<AppEnv>, reason: string, passkey: PasskeyRow | null): Promise<void> {
  await recordAudit(c, {
    action: AUDIT_ACTIONS.loginFailed,
    actorUserId: null,
    ...(passkey ? { targetType: "user" as const, targetId: passkey.user_id } : {}),
    detail: { method: "passkey", reason, ...(passkey ? { passkey_id: passkey.id } : {}) },
  });
}

authPasskeyRoutes.post("/options", async (c) => {
  await requireLoginMethod(c.env.APP_DB, "passkey");
  const options = await authenticationOptions(relyingParty(c.env));
  await issuePasskeyChallenge(c, "login", options.challenge);
  return c.json(options);
});

/** 可发现凭据会带 userHandle：带了就必须与该凭据所属用户的 handle 一致 */
async function userHandleMatches(c: Context<AppEnv>, passkey: PasskeyRow, given: string | undefined): Promise<boolean> {
  if (given === undefined) return true;
  const expected = encodeHandle(await passkeyUserHandle(c.env, passkey.user_id));
  return timingSafeEqualStrings(given, expected);
}

/** 校验断言；计数器回退单独写一条审计（可能是被克隆的认证器） */
async function verifyAssertion(
  c: Context<AppEnv>,
  passkey: PasskeyRow,
  challenge: string,
  response: PasskeyLoginVerifyRequest["response"],
): Promise<number> {
  try {
    return await verifyAuthentication(relyingParty(c.env), challenge, response, {
      credential_id: passkey.credential_id,
      public_key: passkey.public_key,
      counter: passkey.counter,
      transports: parseTransports(passkey),
    });
  } catch (error) {
    if (!(error instanceof PasskeyVerificationError)) throw error;
    console.warn("passkey assertion rejected", error.reason, error.message);
    if (error.reason === "counter_rollback") {
      await recordAudit(c, {
        action: AUDIT_ACTIONS.passkeyCounterRollback,
        actorUserId: null,
        targetType: "passkey",
        targetId: passkey.id,
        detail: { user_id: passkey.user_id, stored_counter: passkey.counter },
      });
    }
    await auditFailure(c, error.reason, passkey);
    throw passkeyInvalid();
  }
}

authPasskeyRoutes.post("/verify", async (c) => {
  const db = c.env.APP_DB;
  await requireLoginMethod(db, "passkey");
  const body = await parseJsonBody(c, passkeyLoginVerifyRequestSchema);
  const { challenge } = await consumePasskeyChallenge(c, "login");

  const passkey = await findPasskeyByCredentialId(db, body.response.id);
  if (!passkey || !(await userHandleMatches(c, passkey, body.response.response.userHandle))) {
    await auditFailure(c, passkey ? "user_handle_mismatch" : "unknown_credential", passkey);
    throw passkeyInvalid();
  }
  const newCounter = await verifyAssertion(c, passkey, challenge, body.response);

  const user = await findUserById(db, passkey.user_id);
  if (!user || user.status !== "active") {
    await auditFailure(c, "disabled", passkey);
    throw passkeyInvalid();
  }
  const now = nowSec();
  if (!(await updatePasskeyCounter(db, passkey.id, passkey.counter, newCounter, now))) {
    await auditFailure(c, "counter_race", passkey);
    throw passkeyInvalid();
  }

  await startSession(c, user.id, ["passkey"]);
  await touchLastLogin(db, user.id, now);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.loginSuccess,
    actorUserId: user.id,
    targetType: "user",
    targetId: user.id,
    detail: { method: "passkey", passkey_id: passkey.id },
  });
  const response: OkResponse = { status: "ok" };
  return c.json(response);
});
