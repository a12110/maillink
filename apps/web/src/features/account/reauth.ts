import { existingPasswordSchema, totpCodeSchema } from "@maillink/shared";

/**
 * 敏感操作的再确认（后端 auth/reauth.ts）：当前密码、当前验证码，或（没有密码的账号）什么都不带，
 * 此时后端要求会话是最近登录的。三种形态对应请求体 `{password}` / `{code}` / `{}`。
 */
export type ReauthMode = "password" | "code" | "none";

export type ReauthBody = { password: string } | { code: string } | Record<string, never>;

export type ReauthContext = {
  hasPassword: boolean;
  totpEnabled: boolean;
  /** 本操作是否允许“没有密码时凭最近登录通过”：启用 2FA 与添加通行密钥允许，关闭 2FA 与重新生成恢复码不允许 */
  allowRecentSession: boolean;
};

/** 当前账号这次操作能用哪些方式，首项是默认方式 */
export function availableReauthModes(context: ReauthContext): ReauthMode[] {
  const modes: ReauthMode[] = [];
  if (context.hasPassword) modes.push("password");
  if (context.totpEnabled) modes.push("code");
  if (!context.hasPassword && context.allowRecentSession) modes.push("none");
  return modes;
}

export const REAUTH_MODE_LABEL: Record<ReauthMode, string> = {
  password: "当前密码",
  code: "验证码",
  none: "最近登录",
};

export type ReauthValues = { password: string; code: string };

/** 把表单值转成请求体；校验不过返回字段错误文案，不发请求 */
export function buildReauthBody(mode: ReauthMode, values: ReauthValues): { ok: true; body: ReauthBody } | { ok: false; error: string } {
  if (mode === "none") return { ok: true, body: {} };
  if (mode === "password") {
    const parsed = existingPasswordSchema.safeParse(values.password);
    return parsed.success ? { ok: true, body: { password: parsed.data } } : { ok: false, error: "请输入当前密码" };
  }
  const parsed = totpCodeSchema.safeParse(values.code);
  return parsed.success ? { ok: true, body: { code: parsed.data } } : { ok: false, error: parsed.error.issues[0]?.message ?? "验证码无效" };
}
