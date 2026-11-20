import { z } from "zod";
import type { ClaimMap } from "@maillink/shared";
import { DISPLAY_NAME_MAX_LENGTH, EMAIL_MAX_LENGTH, OAUTH_SUBJECT_MAX_LENGTH } from "../../constants";

// 按 claim_map 的点路径从 id_token 或 userinfo 里取 subject / email / email_verified / name。

export type OAuthProfile = {
  subject: string;
  email: string | null;
  /** 只有声明值是布尔 true 才算已验证；字符串 "true"、缺失都算未验证 */
  emailVerified: boolean;
  name: string | null;
};

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

/** 沿点路径取值；只读自有属性，路径中断返回 undefined */
export function readClaim(claims: Record<string, unknown>, path: string): unknown {
  let current: unknown = claims;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    if (!Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function readSubject(value: unknown): string {
  // GitHub 等提供方的用户 id 是数字
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string" || text.length === 0 || text.length > OAUTH_SUBJECT_MAX_LENGTH) {
    throw new ProfileError("提供方没有返回有效的 subject");
  }
  return text;
}

const emailSchema = z.email().max(EMAIL_MAX_LENGTH);

function readEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = emailSchema.safeParse(value.trim().toLowerCase());
  return parsed.success ? parsed.data : null;
}

function readName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, DISPLAY_NAME_MAX_LENGTH);
}

export function extractProfile(claims: Record<string, unknown>, map: ClaimMap): OAuthProfile {
  const email = map.email ? readEmail(readClaim(claims, map.email)) : null;
  const verified = map.email_verified ? readClaim(claims, map.email_verified) === true : false;
  return {
    subject: readSubject(readClaim(claims, map.subject)),
    email,
    emailVerified: email !== null && verified,
    name: map.name ? readName(readClaim(claims, map.name)) : null,
  };
}
