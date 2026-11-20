import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { OAUTH_SLUG_MAX_LENGTH, OAUTH_SLUG_PATTERN } from "@maillink/shared";
import type { OAuthResultCode } from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { loginMethodEnabled } from "../auth/login-method-gate";
import { resolveOAuthOutcome } from "../auth/oauth-link";
import { OAuthFlowError, authorizationUrl, exchangeCode, fetchProfile, pkceChallenge, stateMatches } from "../auth/oauth/flow";
import { callbackUrl, openClientSecret } from "../auth/oauth/provider";
import { startFlowState, takeFlowState } from "../auth/oauth/state";
import type { OAuthFlowState, OAuthMode } from "../auth/oauth/state";
import { authenticate } from "../auth/session";
import { nowSec } from "../clock";
import { findProviderById, findProviderBySlug } from "../db/oauth-providers";
import type { OAuthProviderRow } from "../db/oauth-providers";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";

// GET /api/auth/oauth/:slug/start?mode=login|link → 302 到提供方；
// GET /api/auth/oauth/:slug/callback → 302 回前端固定路径并带结果码（login 回 /login，link 回 /account，
// 查询参数 oauth=<结果码>&provider=<slug>）。令牌与授权码从不出现在回前端的 URL 里。

export const authOAuthRoutes = new Hono<AppEnv>();

const RESULT_PATHS: Record<OAuthMode, string> = { login: "/login", link: "/account" };
const slugSchema = z.string().max(OAUTH_SLUG_MAX_LENGTH).regex(OAUTH_SLUG_PATTERN);
const modeSchema = z.enum(["login", "link"]).catch("login");
const PARAM_MAX_LENGTH = 4096;
const callbackQuerySchema = z.object({
  state: z.string().max(PARAM_MAX_LENGTH).optional(),
  code: z.string().max(PARAM_MAX_LENGTH).optional(),
  error: z.string().max(PARAM_MAX_LENGTH).optional(),
});

function redirectResult(c: Context<AppEnv>, mode: OAuthMode, code: OAuthResultCode, slug: string | null): Response {
  const url = new URL(RESULT_PATHS[mode], new URL(c.env.PUBLIC_ORIGIN).origin);
  url.searchParams.set("oauth", code);
  if (slug) url.searchParams.set("provider", slug);
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  return c.redirect(url.toString(), 302);
}

/** 启用中、登录方式开放、且 slug 合法的提供方；否则 null */
async function usableProvider(c: Context<AppEnv>, slug: string): Promise<OAuthProviderRow | null> {
  if (!slugSchema.safeParse(slug).success) return null;
  const db = c.env.APP_DB;
  const provider = await findProviderBySlug(db, slug);
  if (!provider || provider.enabled !== 1 || !(await loginMethodEnabled(db, "oauth"))) return null;
  return provider;
}

async function sessionUserId(c: Context<AppEnv>): Promise<number | null> {
  try {
    return (await authenticate(c)).user.id;
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}

authOAuthRoutes.get("/:slug/start", async (c) => {
  const slug = c.req.param("slug");
  const mode = modeSchema.parse(c.req.query("mode"));
  const provider = await usableProvider(c, slug);
  if (!provider) return redirectResult(c, mode, "provider_unavailable", null);

  const userId = mode === "link" ? await sessionUserId(c) : null;
  if (mode === "link" && userId === null) return redirectResult(c, mode, "link_requires_login", provider.slug);

  const flow = await startFlowState(c, { providerId: provider.id, slug: provider.slug, oidc: provider.kind === "oidc", mode, userId });
  const location = authorizationUrl(provider, {
    redirectUri: callbackUrl(c.env, provider.slug),
    state: flow.st,
    nonce: flow.nn,
    codeChallenge: await pkceChallenge(flow.cv),
  });
  c.header("Cache-Control", "no-store");
  return c.redirect(location, 302);
});

/** 发起之后管理员可能停用了提供方或关掉了 oauth 登录：回调时重新检查，不放行 */
async function callbackProvider(c: Context<AppEnv>, flow: OAuthFlowState, slug: string): Promise<OAuthProviderRow | null> {
  const db = c.env.APP_DB;
  const provider = await findProviderById(db, flow.pid);
  if (!provider || provider.enabled !== 1 || provider.slug !== slug) return null;
  return (await loginMethodEnabled(db, "oauth")) ? provider : null;
}

async function checkCallback(
  c: Context<AppEnv>,
  flow: OAuthFlowState,
  slug: string,
): Promise<{ provider: OAuthProviderRow; code: string } | OAuthResultCode> {
  const query = callbackQuerySchema.safeParse(c.req.query());
  if (!query.success || flow.slug !== slug || !(await stateMatches(query.data.state ?? "", flow.st))) {
    return "state_invalid";
  }
  if (query.data.error !== undefined || !query.data.code) return "denied";
  const provider = await callbackProvider(c, flow, slug);
  return provider ? { provider, code: query.data.code } : "provider_unavailable";
}

authOAuthRoutes.get("/:slug/callback", async (c) => {
  const slug = c.req.param("slug");
  const flow = await takeFlowState(c);
  if (!flow) return redirectResult(c, "login", "state_invalid", null);
  const checked = await checkCallback(c, flow, slug);
  if (typeof checked === "string") return redirectResult(c, flow.mode, checked, flow.slug);
  const { provider, code } = checked;

  try {
    const tokens = await exchangeCode(provider, await openClientSecret(c.env, provider), {
      code,
      codeVerifier: flow.cv,
      redirectUri: callbackUrl(c.env, provider.slug),
    });
    const profile = await fetchProfile(provider, tokens, flow.nn, nowSec());
    return redirectResult(c, flow.mode, await resolveOAuthOutcome(c, provider, profile, flow), provider.slug);
  } catch (error) {
    if (!(error instanceof OAuthFlowError)) throw error;
    console.warn("oauth callback failed", provider.slug, error.code, error.message);
    await auditFlowFailure(c, flow, provider, error.code);
    return redirectResult(c, flow.mode, error.code, provider.slug);
  }
});

/** 换 token、校验 id_token、取资料失败都写审计（03 §8）；link 模式记为绑定被拒 */
async function auditFlowFailure(
  c: Context<AppEnv>,
  flow: OAuthFlowState,
  provider: OAuthProviderRow,
  reason: OAuthFlowError["code"],
): Promise<void> {
  const method = `oauth:${provider.slug}`;
  if (flow.mode === "link") {
    await recordAudit(c, {
      action: AUDIT_ACTIONS.identityLinkRejected,
      actorUserId: flow.uid,
      ...(flow.uid === null ? {} : { targetType: "user" as const, targetId: flow.uid }),
      detail: { method, provider: provider.slug, reason },
    });
    return;
  }
  await recordAudit(c, { action: AUDIT_ACTIONS.loginFailed, actorUserId: null, detail: { method, reason } });
}
