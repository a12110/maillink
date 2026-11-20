import type { Context } from "hono";
import { AUDIT_ACTIONS } from "../audit";
import { nowSec } from "../clock";
import { RECENT_AUTH_SEC } from "../constants";
import type { UserRow } from "../db/users";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { HTTP_BAD_REQUEST } from "../http-status";
import { burnPasswordCheck, verifyPassword } from "./password";
import { reserveSecondFactor, secondFactorFailed, secondFactorSucceeded } from "./second-factor-throttle";
import { verifyUserTotp } from "./totp-service";

// 敏感操作再确认（关闭 2FA、重新生成恢复码、启用 2FA、添加通行密钥）：当前密码或当前 TOTP 二选一。
// 每次密码 / TOTP 校验都占用按用户的第二因素尝试次数（与登录第二步共用，锁定中 429）。
// allowRecentSession：没有密码的账号（只有 OAuth 或通行密钥）可凭"会话创建不超过 RECENT_AUTH_SEC"通过，
// 拿到旧会话的人仍需重新登录一次才能给账号加通行密钥或 2FA。

export type ReauthInput = { password?: string | undefined; code?: string | undefined };

const SECONDS_PER_MINUTE = 60;

function reauthRequired(user: UserRow): ApiError {
  const minutes = Math.floor(RECENT_AUTH_SEC / SECONDS_PER_MINUTE);
  const hint = user.password_hash === null ? `请重新登录后在 ${minutes} 分钟内操作，或输入验证码` : "请输入当前密码或验证码";
  return new ApiError(HTTP_BAD_REQUEST, "reauth_required", hint);
}

async function checkFactor(c: Context<AppEnv>, user: UserRow, input: ReauthInput): Promise<boolean> {
  if (input.password !== undefined) {
    return user.password_hash
      ? verifyPassword(c.env, input.password, user.password_hash)
      : burnPasswordCheck(c.env, input.password);
  }
  return (await verifyUserTotp(c.env, user.id, input.code ?? "", nowSec())) === "ok";
}

export async function reauthenticate(
  c: Context<AppEnv>,
  user: UserRow,
  input: ReauthInput,
  options: { purpose: string; allowRecentSession: boolean },
): Promise<void> {
  if (input.password === undefined && input.code === undefined) {
    const recent = nowSec() - c.var.auth.session.createdAt <= RECENT_AUTH_SEC;
    if (options.allowRecentSession && user.password_hash === null && recent) return;
    throw reauthRequired(user);
  }
  const slot = await reserveSecondFactor(c, user.id);
  if (await checkFactor(c, user, input)) {
    await secondFactorSucceeded(c, user.id);
    return;
  }
  await secondFactorFailed(c, user.id, slot, {
    action: AUDIT_ACTIONS.reauthFailed,
    detail: { method: input.password !== undefined ? "password" : "totp", purpose: options.purpose },
  });
  throw new ApiError(HTTP_BAD_REQUEST, "reauth_failed", "当前密码或验证码错误");
}
