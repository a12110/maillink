import { AccentUnreachableError, assertAccentReachable } from "@maillink/shared";
import type { TurnstileSettingsInput, WritableSettingGroup } from "@maillink/shared";
import { anyAdminCanLogIn, anyAdminHasSecondFactor } from "../db/admin-lockout";
import { getSettings } from "../db/settings";
import type { SettingEntry } from "../db/settings";
import type { Bindings } from "../env";
import { ApiError } from "../errors";
import { HTTP_BAD_REQUEST } from "../http-status";
import { loadTurnstileConfig, sealTurnstileSecret } from "../turnstile/config";

// PUT /api/admin/settings/:group 在 zod 校验之后、写库之前做的分组专属检查与准备。
// 返回要写的字段（values）、不属于分组字段的额外键（extra，如加密后的 Turnstile secret）与审计补充信息。

export type PreparedSettings = {
  values: Record<string, unknown>;
  extra: SettingEntry[];
  auditNote: Record<string, unknown>;
};

type PrepareEnv = Pick<Bindings, "APP_DB" | "APP_SECRET">;

function badRequest(code: string, message: string): ApiError {
  return new ApiError(HTTP_BAD_REQUEST, code, message);
}

/** 强调色在明暗两套底色下都要能推导出达标的按钮与文字颜色；不可达返回 400 accent_unreachable */
export function assertAccentAllowed(hex: string, grounds?: Parameters<typeof assertAccentReachable>[1]): void {
  try {
    assertAccentReachable(hex, grounds);
  } catch (error) {
    if (error instanceof AccentUnreachableError) throw badRequest("accent_unreachable", `强调色 ${hex} 无法保证按钮与文字的对比度：${error.message}`);
    throw error;
  }
}

async function prepareAuth(env: PrepareEnv, values: Record<string, unknown>): Promise<void> {
  const methods = values.login_methods as Array<"password" | "passkey" | "oauth">;
  if (!(await anyAdminCanLogIn(env.APP_DB, methods))) {
    throw badRequest(
      "login_methods_lockout",
      "按此设置没有任何启用的管理员还能登录：至少要有一个启用的管理员，在开放的登录方式里有可用凭据（有密码，或有通行密钥，或绑定了已启用的 OAuth 提供方）",
    );
  }
  const { "security.admin_require_2fa": require2fa } = await getSettings(env.APP_DB, ["security.admin_require_2fa"]);
  if (require2fa && !(await anyAdminHasSecondFactor(env.APP_DB, methods))) {
    throw badRequest("admin_2fa_lockout", "已开启管理员强制两步验证：按此登录方式设置，没有管理员还能完成两步验证登录");
  }
}

async function prepareSecurity(env: PrepareEnv, values: Record<string, unknown>): Promise<void> {
  if (values.admin_require_2fa !== true) return;
  const { "auth.login_methods": methods } = await getSettings(env.APP_DB, ["auth.login_methods"]);
  if (!(await anyAdminHasSecondFactor(env.APP_DB, methods))) {
    throw badRequest(
      "admin_2fa_lockout",
      "开启后所有管理员都会被挡在 /api/admin 之外：至少要有一个启用的管理员已启用 TOTP 且能用开放的密码或 OAuth 登录，或登记了通行密钥且通行密钥登录开放",
    );
  }
}

async function prepareTurnstile(env: PrepareEnv, input: TurnstileSettingsInput): Promise<PreparedSettings> {
  const current = await loadTurnstileConfig(env.APP_DB);
  const secretEnc = input.secret === undefined ? current.secretEnc : await sealTurnstileSecret(env, input.secret);
  if (input.enabled) {
    if (input.site_key === "") throw badRequest("turnstile_incomplete", "启用 Turnstile 需要填写 site key");
    if (secretEnc === "") throw badRequest("turnstile_incomplete", "启用 Turnstile 需要设置 secret");
    if (input.scopes.length === 0) throw badRequest("turnstile_incomplete", "启用 Turnstile 需要至少选择一个作用范围");
  }
  const { secret: _secret, ...fields } = input;
  return {
    values: fields,
    extra: input.secret === undefined ? [] : [["turnstile.secret_enc", secretEnc]],
    auditNote: input.secret === undefined ? {} : { new_key_saved: true },
  };
}

export async function prepareSettings(
  env: PrepareEnv,
  group: WritableSettingGroup,
  input: Record<string, unknown>,
): Promise<PreparedSettings> {
  if (group === "turnstile") return prepareTurnstile(env, input as TurnstileSettingsInput);
  if (group === "appearance") assertAccentAllowed(input.accent as string);
  if (group === "auth") await prepareAuth(env, input);
  if (group === "security") await prepareSecurity(env, input);
  return { values: input, extra: [], auditNote: {} };
}
