import { Hono } from "hono";
import type { Context } from "hono";
import {
  passkeyOptionsRequestSchema,
  passkeyRegisterVerifyRequestSchema,
  passkeyRenameRequestSchema,
} from "@maillink/shared";
import type { MyPasskey, OkResponse } from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { requireLoginMethod } from "../auth/login-method-gate";
import { challengeInvalid, consumePasskeyChallenge, issuePasskeyChallenge } from "../auth/passkey-flow";
import { reauthenticate } from "../auth/reauth";
import {
  PasskeyVerificationError,
  passkeyUserHandle,
  registrationOptions,
  relyingParty,
  verifyRegistration,
} from "../auth/webauthn";
import { nowSec } from "../clock";
import { PASSKEY_MAX_PER_USER } from "../constants";
import { uniqueViolationTarget } from "../db/errors";
import {
  deleteOwnPasskey,
  insertPasskey,
  listUserPasskeys,
  parseTransports,
  passkeyExists,
  renamePasskey,
} from "../db/passkeys";
import type { PasskeyRow } from "../db/passkeys";
import { getSettings } from "../db/settings";
import { findUserById } from "../db/users";
import type { AppEnv } from "../env";
import { ApiError, notFoundError } from "../errors";
import { HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_CREATED } from "../http-status";
import { parseIdParam, parseJsonBody } from "../validate";

// /api/me/passkeys（03 §4.3、§6）：注册（options → verify）、列表、改名、删除。

export const mePasskeyRoutes = new Hono<AppEnv>();

export function toMyPasskey(row: PasskeyRow): MyPasskey {
  return {
    id: row.id,
    name: row.name,
    transports: parseTransports(row),
    created_at: row.created_at,
    last_used_at: row.last_used_at,
  };
}

function tooManyPasskeys(): ApiError {
  return new ApiError(HTTP_CONFLICT, "passkey_limit_reached", `最多只能注册 ${PASSKEY_MAX_PER_USER} 个通行密钥`);
}

mePasskeyRoutes.get("/", async (c) => {
  const rows = await listUserPasskeys(c.env.APP_DB, c.var.auth.user.id);
  return c.json({ items: rows.map(toMyPasskey) });
});

mePasskeyRoutes.post("/options", async (c) => {
  const db = c.env.APP_DB;
  const { user } = c.var.auth;
  await requireLoginMethod(db, "passkey");
  const body = await parseJsonBody(c, passkeyOptionsRequestSchema);
  const row = await findUserById(db, user.id);
  if (!row) throw notFoundError("用户不存在");
  // 通行密钥是长期凭据，绕过 2FA、改密码也清不掉：注册前必须再确认身份（拿到会话不等于拿到账号）
  await reauthenticate(c, row, body, { purpose: "passkey_add", allowRecentSession: true });
  const existing = await listUserPasskeys(db, user.id);
  if (existing.length >= PASSKEY_MAX_PER_USER) throw tooManyPasskeys();

  const { "site.name": rpName } = await getSettings(db, ["site.name"]);
  const options = await registrationOptions({
    rp: relyingParty(c.env),
    rpName,
    userHandle: await passkeyUserHandle(c.env, user.id),
    userName: user.username,
    displayName: user.display_name ?? user.username,
    exclude: existing.map((row) => ({ credential_id: row.credential_id, transports: parseTransports(row) })),
  });
  await issuePasskeyChallenge(c, "registration", options.challenge, user.id);
  return c.json(options);
});

async function verifyNewCredential(c: Context<AppEnv>, response: Parameters<typeof verifyRegistration>[2]) {
  const challenge = await consumePasskeyChallenge(c, "registration");
  if (challenge.userId !== c.var.auth.user.id) throw challengeInvalid();
  try {
    return await verifyRegistration(relyingParty(c.env), challenge.challenge, response);
  } catch (error) {
    if (!(error instanceof PasskeyVerificationError)) throw error;
    console.warn("passkey registration rejected", error.message);
    throw new ApiError(HTTP_BAD_REQUEST, "passkey_verification_failed", "通行密钥校验失败");
  }
}

mePasskeyRoutes.post("/verify", async (c) => {
  const db = c.env.APP_DB;
  const { user } = c.var.auth;
  await requireLoginMethod(db, "passkey");
  const body = await parseJsonBody(c, passkeyRegisterVerifyRequestSchema);
  const credential = await verifyNewCredential(c, body.response);
  const existing = await listUserPasskeys(db, user.id);
  if (existing.length >= PASSKEY_MAX_PER_USER) throw tooManyPasskeys();

  const name = body.name ?? `通行密钥 ${existing.length + 1}`;
  let id: number;
  try {
    id = await insertPasskey(
      db,
      {
        user_id: user.id,
        name,
        credential_id: credential.credentialId,
        public_key: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports,
      },
      nowSec(),
    );
  } catch (error) {
    if (uniqueViolationTarget(error) === "user_passkeys.credential_id") {
      throw new ApiError(HTTP_CONFLICT, "passkey_already_registered", "该通行密钥已注册");
    }
    throw error;
  }
  await recordAudit(c, {
    action: AUDIT_ACTIONS.passkeyAdd,
    actorUserId: user.id,
    targetType: "passkey",
    targetId: id,
    detail: { name },
  });
  const created = (await listUserPasskeys(db, user.id)).find((row) => row.id === id);
  if (!created) throw notFoundError("通行密钥不存在");
  return c.json(toMyPasskey(created), HTTP_CREATED);
});

mePasskeyRoutes.patch("/:id", async (c) => {
  const { user } = c.var.auth;
  const id = parseIdParam(c);
  const body = await parseJsonBody(c, passkeyRenameRequestSchema);
  if (!(await renamePasskey(c.env.APP_DB, user.id, id, body.name))) throw notFoundError("通行密钥不存在");
  await recordAudit(c, {
    action: AUDIT_ACTIONS.passkeyRename,
    actorUserId: user.id,
    targetType: "passkey",
    targetId: id,
    detail: { name: body.name },
  });
  const response: OkResponse = { status: "ok" };
  return c.json(response);
});

mePasskeyRoutes.delete("/:id", async (c) => {
  const db = c.env.APP_DB;
  const { user } = c.var.auth;
  const id = parseIdParam(c);
  if (!(await deleteOwnPasskey(db, user.id, id))) {
    if (!(await passkeyExists(db, user.id, id))) throw notFoundError("通行密钥不存在");
    throw lastLoginMethodError();
  }
  await recordAudit(c, { action: AUDIT_ACTIONS.passkeyRemove, actorUserId: user.id, targetType: "passkey", targetId: id });
  const response: OkResponse = { status: "ok" };
  return c.json(response);
});

export function lastLoginMethodError(): ApiError {
  return new ApiError(HTTP_CONFLICT, "last_login_method", "至少需要保留一种登录方式（密码、通行密钥或 OAuth 绑定）");
}
