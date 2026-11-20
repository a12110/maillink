import type { Context } from "hono";
import type { OAuthResultCode } from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { nowSec } from "../clock";
import { uniqueViolationTarget } from "../db/errors";
import { findAutoLinkCandidate, findIdentity, insertIdentity, touchIdentity } from "../db/identities";
import type { IdentityRow, NewIdentity } from "../db/identities";
import type { OAuthProviderRow } from "../db/oauth-providers";
import { getSettings } from "../db/settings";
import { findUserById, touchLastLogin } from "../db/users";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import type { AuthContext } from "./context";
import { issuePendingAuth } from "./mfa";
import type { OAuthProfile } from "./oauth/claims";
import type { OAuthFlowState } from "./oauth/state";
import { signupOAuthUser } from "./oauth-signup";
import { authenticate, startSession } from "./session";

// OAuth 回调拿到可信的 (provider, subject) 之后决定结果（03 §4.4）。
//
// 已绑定 → 登录（auth_methods 记 oauth:<slug>）。D7：默认不再要求本地 2FA；
//   设置 auth.oauth_require_2fa = true 时，已启用 TOTP 的用户改走 pending_auth；
//   设置 security.admin_require_2fa = true 时，已启用 TOTP 的管理员同样改走 pending_auth。
// 未绑定 + link → 绑到当前登录用户（回调时必须仍是发起绑定的那个用户的那个会话）；该身份已绑别人则拒绝。
// 未绑定 + login → 依次尝试：自动关联（见下）→ 自动建号（提供方 allow_signup 且系统开启注册）→ 拒绝 not_linked。
//
// 自动按邮箱关联的规则（默认关闭；本系统不验证本地邮箱，所以只能信任管理员设置的邮箱）：
//   1. 提供方开启了 auto_link_verified_email；
//   2. IdP 返回的 email_verified 必须是布尔 true（字符串 "true"、缺失都不算）；
//   3. 只在 login 模式、且 (provider, subject) 尚未绑定任何账号时发生；
//   4. 本地账号的邮箱与 IdP 邮箱完全相同（统一小写比较）；
//   5. 本地账号的邮箱必须由管理员设置（users.email_admin_set = 1：管理员建号或在管理端改过邮箱，
//      且用户之后没有自己改过——用户自己改邮箱会把标记清零）；用户自填的邮箱一律不参与关联；
//   6. 只关联 role = user 且启用中的账号，管理员账号永不自动关联（只能在账号页手动绑定）；
//   7. 该账号还没有绑定这个提供方的任何身份（不替用户悄悄加第二个同提供方账号）；
//   8. 关联写审计 auth.identity_link（detail.auto = true）。

type LinkContext = { c: Context<AppEnv>; provider: OAuthProviderRow; profile: OAuthProfile };

function identityValues(ctx: LinkContext): NewIdentity {
  return {
    provider_id: ctx.provider.id,
    subject: ctx.profile.subject,
    email: ctx.profile.email,
    display_name: ctx.profile.name,
  };
}

function isIdentityConflict(error: unknown): boolean {
  return uniqueViolationTarget(error) === "user_identities.provider_id";
}

async function loginAs(ctx: LinkContext, userId: number, via: "identity" | "auto_link" | "signup"): Promise<OAuthResultCode> {
  const { c, provider } = ctx;
  const db = c.env.APP_DB;
  const user = await findUserById(db, userId);
  const method = `oauth:${provider.slug}`;
  if (!user || user.status !== "active") {
    await recordAudit(c, {
      action: AUDIT_ACTIONS.loginFailed,
      actorUserId: null,
      targetType: "user",
      targetId: userId,
      detail: { method, reason: "disabled" },
    });
    return "account_disabled";
  }
  const settings = await getSettings(db, ["auth.oauth_require_2fa", "security.admin_require_2fa"]);
  // 开启"管理员强制 2FA"时，对管理员等同强制 oauth_require_2fa：否则 OAuth 单因素会话进不了管理端
  const adminForced = settings["security.admin_require_2fa"] && user.role === "admin";
  if ((settings["auth.oauth_require_2fa"] || adminForced) && user.totp_enabled_at !== null) {
    await issuePendingAuth(c, user.id, [method]);
    return "mfa_required";
  }
  await startSession(c, user.id, [method]);
  await touchLastLogin(db, user.id, nowSec());
  await recordAudit(c, {
    action: AUDIT_ACTIONS.loginSuccess,
    actorUserId: user.id,
    targetType: "user",
    targetId: user.id,
    detail: { method, via },
  });
  return "ok";
}

async function loginExisting(ctx: LinkContext, identity: IdentityRow): Promise<OAuthResultCode> {
  const result = await loginAs(ctx, identity.user_id, "identity");
  if (result !== "account_disabled") {
    await touchIdentity(ctx.c.env.APP_DB, identity.id, { email: ctx.profile.email, display_name: ctx.profile.name }, nowSec());
  }
  return result;
}

async function tryAutoLink(ctx: LinkContext): Promise<OAuthResultCode | null> {
  const { c, provider, profile } = ctx;
  if (provider.auto_link_verified_email !== 1 || !profile.emailVerified || profile.email === null) return null;
  const candidate = await findAutoLinkCandidate(c.env.APP_DB, profile.email, provider.id);
  if (!candidate) return null;
  let identityId: number;
  try {
    identityId = await insertIdentity(c.env.APP_DB, candidate.id, identityValues(ctx), nowSec(), null);
  } catch (error) {
    if (isIdentityConflict(error)) return "identity_taken";
    throw error;
  }
  await recordAudit(c, {
    action: AUDIT_ACTIONS.identityLink,
    actorUserId: null,
    targetType: "identity",
    targetId: identityId,
    detail: { user_id: candidate.id, provider: provider.slug, auto: true },
  });
  return loginAs(ctx, candidate.id, "auto_link");
}

async function resolveLogin(ctx: LinkContext): Promise<OAuthResultCode> {
  const { c, provider } = ctx;
  const autoLinked = await tryAutoLink(ctx);
  if (autoLinked !== null) return autoLinked;

  const { "registration.enabled": registration } = await getSettings(c.env.APP_DB, ["registration.enabled"]);
  if (provider.allow_signup === 1 && registration) {
    const userId = await signupOAuthUser(c, provider, ctx.profile);
    return userId === null ? "signup_failed" : loginAs(ctx, userId, "signup");
  }
  await recordAudit(c, {
    action: AUDIT_ACTIONS.loginFailed,
    actorUserId: null,
    detail: { method: `oauth:${provider.slug}`, reason: "not_linked" },
  });
  return "not_linked";
}

async function currentAuth(c: Context<AppEnv>): Promise<AuthContext | null> {
  try {
    return await authenticate(c);
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}

/**
 * link 模式：回调时的会话必须就是发起绑定的那一个（state 绑定的 uid 与会话 idHash 都一致）。
 * 期间退出、换了账号、或会话被注销都拒绝，并写审计。
 */
async function linkingUserId(ctx: LinkContext, flow: OAuthFlowState): Promise<number | null> {
  const auth = await currentAuth(ctx.c);
  // flow.uid / flow.sh 为 null（登录流程的状态）时恒不相等
  if (auth !== null && auth.user.id === flow.uid && auth.session.idHash === flow.sh) return auth.user.id;
  await recordAudit(ctx.c, {
    action: AUDIT_ACTIONS.identityLinkRejected,
    actorUserId: flow.uid,
    ...(flow.uid === null ? {} : { targetType: "user" as const, targetId: flow.uid }),
    detail: { provider: ctx.provider.slug, reason: "session_mismatch" },
  });
  return null;
}

async function resolveLink(ctx: LinkContext, flow: OAuthFlowState, existing: IdentityRow | null): Promise<OAuthResultCode> {
  const { c, provider } = ctx;
  const userId = await linkingUserId(ctx, flow);
  if (userId === null) return "link_requires_login";
  if (existing) {
    if (existing.user_id === userId) return "already_linked";
    await recordAudit(c, {
      action: AUDIT_ACTIONS.identityLinkRejected,
      actorUserId: userId,
      targetType: "identity",
      targetId: existing.id,
      detail: { provider: provider.slug, reason: "bound_to_other_user" },
    });
    return "identity_taken";
  }
  let identityId: number;
  try {
    identityId = await insertIdentity(c.env.APP_DB, userId, identityValues(ctx), nowSec(), null);
  } catch (error) {
    if (isIdentityConflict(error)) return "identity_taken";
    throw error;
  }
  await recordAudit(c, {
    action: AUDIT_ACTIONS.identityLink,
    actorUserId: userId,
    targetType: "identity",
    targetId: identityId,
    detail: { user_id: userId, provider: provider.slug, auto: false },
  });
  return "linked";
}

export async function resolveOAuthOutcome(
  c: Context<AppEnv>,
  provider: OAuthProviderRow,
  profile: OAuthProfile,
  flow: OAuthFlowState,
): Promise<OAuthResultCode> {
  const ctx: LinkContext = { c, provider, profile };
  const existing = await findIdentity(c.env.APP_DB, provider.id, profile.subject);
  if (flow.mode === "link") return resolveLink(ctx, flow, existing);
  return existing ? loginExisting(ctx, existing) : resolveLogin(ctx);
}
