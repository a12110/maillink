import type { Context } from "hono";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { nowSec } from "../clock";
import {
  OAUTH_USERNAME_MAX_TRIES,
  OAUTH_USERNAME_SUFFIX_BYTES,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from "../constants";
import { uniqueViolationTarget } from "../db/errors";
import { insertUserWithIdentity } from "../db/identities";
import type { OAuthProviderRow } from "../db/oauth-providers";
import type { AppEnv } from "../env";
import { randomBytes, toHex } from "./crypto";
import type { OAuthProfile } from "./oauth/claims";

// OAuth 自动建号（提供方 allow_signup 且系统开启注册）：角色固定 user、不设密码、没有任何授权（03 §5）。
// 用户名从 IdP 邮箱前缀 / 显示名推导，冲突时加随机后缀重试；邮箱只在 IdP 标记已验证时写入（不设"管理员设置"标记）。

const SUFFIX_LENGTH = OAUTH_USERNAME_SUFFIX_BYTES * 2 + 1;

function sanitize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, USERNAME_MAX_LENGTH - SUFFIX_LENGTH)
    .replace(/[^a-z0-9]+$/, "");
}

export function baseUsername(profile: OAuthProfile, slug: string): string {
  const candidates = [profile.email?.split("@")[0] ?? "", profile.name ?? ""].map(sanitize);
  const picked = candidates.find((item) => item.length >= USERNAME_MIN_LENGTH && USERNAME_PATTERN.test(item));
  return picked ?? sanitize(`${slug}-user`);
}

function withSuffix(base: string): string {
  return `${base}-${toHex(randomBytes(OAUTH_USERNAME_SUFFIX_BYTES))}`;
}

/** 建号并绑定，返回新用户 id；用户名多次冲突或邮箱冲突时返回 null（调用方回 signup_failed） */
export async function signupOAuthUser(
  c: Context<AppEnv>,
  provider: OAuthProviderRow,
  profile: OAuthProfile,
): Promise<number | null> {
  const base = baseUsername(profile, provider.slug);
  const email = profile.emailVerified ? profile.email : null;
  for (let attempt = 0; attempt < OAUTH_USERNAME_MAX_TRIES; attempt += 1) {
    const username = attempt === 0 ? base : withSuffix(base);
    try {
      const userId = await insertUserWithIdentity(
        c.env.APP_DB,
        { username, display_name: profile.name, email, role: "user", status: "active", password_hash: null },
        { provider_id: provider.id, subject: profile.subject, email: profile.email, display_name: profile.name },
        nowSec(),
      );
      await recordAudit(c, {
        action: AUDIT_ACTIONS.oauthSignup,
        actorUserId: userId,
        targetType: "user",
        targetId: userId,
        detail: { provider: provider.slug, username },
      });
      return userId;
    } catch (error) {
      const target = uniqueViolationTarget(error);
      if (target !== "users.username_lc") {
        if (target === null) throw error;
        console.warn("oauth signup conflict", target);
        return null;
      }
    }
  }
  console.warn("oauth signup: username retries exhausted", base);
  return null;
}
