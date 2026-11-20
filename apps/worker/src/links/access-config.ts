import {
  LINK_PUBLIC_ERRORS,
  linkAccessIssue,
  linkAccessStoredSchema,
  type LinkAccessInputParsed,
  type LinkAccessStored,
  type LinkAccessView,
} from "@maillink/shared";
import { hashPassword } from "../auth/password";
import { getSettings } from "../db/settings";
import type { Bindings } from "../env";
import { ApiError } from "../errors";
import { HTTP_BAD_REQUEST } from "../http-status";
import { loadTurnstileConfig, type TurnstileConfig } from "../turnstile/config";

// 访问约束（share_links.access）的入参 → 存储 → 展示。口令只存 PBKDF2 哈希（复用账号密码的哈希函数）。

/** 与 turnstile/verify.ts 里 pickup 入口"需要校验时能校验"的条件一致 */
function pickupTurnstileReady(config: TurnstileConfig): boolean {
  return config.enabled && config.scopes.includes("pickup") && config.siteKey !== "" && config.secretEnc !== "";
}

/**
 * 校验跨字段约束并生成存储形态。
 * - turnstile=true：系统 Turnstile 必须已启用、作用范围含 pickup、site key 与 secret 都已配置，否则 400；
 * - 设了取码次数上限却不是 click：400；
 * - poll_interval_sec 未给时用系统设置 links.default_poll_interval_sec；
 * - password 未给时沿用 previous 的哈希（创建时 previous 为 null）。
 */
export async function buildStoredAccess(
  env: Pick<Bindings, "APP_SECRET" | "APP_DB">,
  input: LinkAccessInputParsed,
  previous: LinkAccessStored | null,
): Promise<LinkAccessStored> {
  if (input.turnstile && !pickupTurnstileReady(await loadTurnstileConfig(env.APP_DB))) {
    throw new ApiError(HTTP_BAD_REQUEST, LINK_PUBLIC_ERRORS.turnstileNotConfigured, "系统尚未配置人机验证（Turnstile）或作用范围不含取件页，不能开启");
  }
  const issue = linkAccessIssue(input);
  if (issue !== null) {
    throw new ApiError(HTTP_BAD_REQUEST, issue, "设置了取码次数上限时，取码方式必须是\"点击取码\"");
  }
  const { password, poll_interval_sec: pollInterval, ...rest } = input;
  const stored: LinkAccessStored = {
    ...rest,
    poll_interval_sec: pollInterval ?? (await getSettings(env.APP_DB, ["links.default_poll_interval_sec"]))["links.default_poll_interval_sec"],
  };
  if (password === undefined) {
    if (previous?.password_hash !== undefined) stored.password_hash = previous.password_hash;
  } else if (password !== null) {
    stored.password_hash = await hashPassword(env, password);
  }
  return stored;
}

/** 库里的 JSON 不合 schema 属于数据损坏：抛错（500）暴露，不当作"无约束"放行 */
export function parseStoredAccess(text: string): LinkAccessStored {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("share_links.access 不是合法的 JSON");
  }
  const result = linkAccessStoredSchema.safeParse(raw);
  if (!result.success) throw new Error(`share_links.access 不合 schema：${result.error.message}`);
  return result.data;
}

export function accessView(access: LinkAccessStored): LinkAccessView {
  const { password_hash: passwordHash, ...rest } = access;
  return { ...rest, has_password: passwordHash !== undefined };
}
