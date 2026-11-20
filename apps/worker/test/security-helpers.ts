import { env } from "cloudflare:workers";
import type { RecoveryCodesResponse, TotpSetupResponse } from "@maillink/shared";
import { base32Decode, hotp, totpStep } from "../src/auth/totp";
import { TEST_PASSWORD, api } from "./helpers";

// M5 测试共用：Cookie 提取、TOTP 计算、启用 2FA。

export type ErrorBody = { error: { code: string; message: string } };

export const nowSec = (): number => Math.floor(Date.now() / 1000);

/** 从响应里取指定 Cookie 的 `name=value`（只取值非空的那条） */
export function cookieFrom(res: Response, name: string): string | undefined {
  const line = res.headers.getSetCookie().find((item) => item.startsWith(`${name}=`) && !item.startsWith(`${name}=;`));
  return line?.split(";")[0];
}

/** 响应里是否有清除该 Cookie 的 Set-Cookie（值为空或 Max-Age=0） */
export function cookieCleared(res: Response, name: string): boolean {
  return res.headers
    .getSetCookie()
    .some((item) => item.startsWith(`${name}=`) && (item.startsWith(`${name}=;`) || /Max-Age=0/i.test(item)));
}

export function joinCookies(...cookies: Array<string | undefined>): string {
  return cookies.filter((item): item is string => Boolean(item)).join("; ");
}

/** 按 base32 密钥算出 now + offsetSteps 个时间步的验证码 */
export function codeAt(secret: string, offsetSteps = 0, at = nowSec()): Promise<string> {
  return hotp(base32Decode(secret), totpStep(at) + offsetSteps);
}

/** 走 setup + enable 启用 2FA（用当前密码再确认；password 为 null 表示不带密码），返回密钥与恢复码。启用用掉当前时间步的码 */
export async function enableTotp(cookie: string, password: string | null = TEST_PASSWORD): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setup = await api("/api/me/totp/setup", { method: "POST", cookie });
  if (setup.status !== 200) throw new Error(`setup 失败 ${setup.status}: ${await setup.text()}`);
  const { secret } = (await setup.json()) as TotpSetupResponse;
  const setupCookie = cookieFrom(setup, "totp_setup");
  const enable = await api("/api/me/totp/enable", {
    json: { code: await codeAt(secret), ...(password === null ? {} : { password }) },
    cookie: joinCookies(cookie, setupCookie),
  });
  if (enable.status !== 200) throw new Error(`enable 失败 ${enable.status}: ${await enable.text()}`);
  const { recovery_codes } = (await enable.json()) as RecoveryCodesResponse;
  return { secret, recoveryCodes: recovery_codes };
}

/** 密码登录拿到 pending_auth Cookie（要求该用户已启用 2FA） */
export async function passwordStep(username: string, password: string): Promise<string> {
  const res = await api("/api/auth/login", { json: { username, password } });
  const body = (await res.json()) as { status: string };
  if (res.status !== 200 || body.status !== "mfa_required") throw new Error(`预期 mfa_required，实际 ${JSON.stringify(body)}`);
  const pending = cookieFrom(res, "pending_auth");
  if (!pending) throw new Error("没有 pending_auth Cookie");
  return pending;
}

export async function userTotpColumns(userId: number) {
  return env.APP_DB
    .prepare("SELECT totp_secret_enc, totp_enabled_at, totp_last_step FROM users WHERE id = ?")
    .bind(userId)
    .first<{ totp_secret_enc: string | null; totp_enabled_at: number | null; totp_last_step: number | null }>();
}
