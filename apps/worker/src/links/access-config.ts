import {
  LINK_PUBLIC_ERRORS,
  linkAccessIssue,
  linkAccessStoredSchema,
  type LinkAccessInputParsed,
  type LinkAccessStored,
  type LinkAccessView,
} from "@maillink/shared";
import { hashPassword } from "../auth/password";
import type { Bindings } from "../env";
import { ApiError } from "../errors";
import { HTTP_BAD_REQUEST } from "../http-status";

// 访问约束（share_links.access）的入参 → 存储 → 展示。口令只存 PBKDF2 哈希（复用账号密码的哈希函数）。

/**
 * 校验跨字段约束并生成存储形态。
 * - turnstile=true：M6 才有 Turnstile 配置与校验，现在一律 400，不假装校验通过；
 * - 设了取码次数上限却不是 click：400；
 * - password 未给时沿用 previous 的哈希（创建时 previous 为 null）。
 */
export async function buildStoredAccess(
  env: Pick<Bindings, "APP_SECRET">,
  input: LinkAccessInputParsed,
  previous: LinkAccessStored | null,
): Promise<LinkAccessStored> {
  if (input.turnstile) {
    throw new ApiError(HTTP_BAD_REQUEST, LINK_PUBLIC_ERRORS.turnstileNotConfigured, "系统尚未配置人机验证（Turnstile），不能开启");
  }
  const issue = linkAccessIssue(input);
  if (issue !== null) {
    throw new ApiError(HTTP_BAD_REQUEST, issue, "设置了取码次数上限时，取码方式必须是\"点击取码\"");
  }
  const { password, ...rest } = input;
  const stored: LinkAccessStored = { ...rest };
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
