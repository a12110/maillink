import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { OAUTH_SLUG_MAX_LENGTH, OAUTH_SLUG_PATTERN, oauthLinkStartRequestSchema } from "@maillink/shared";
import type { OAuthLinkStartResponse, OAuthResultCode } from "@maillink/shared";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { loginMethodEnabled } from "../auth/login-method-gate";
import { resolveOAuthOutcome } from "../auth/oauth-link";
import { OAuthFlowError, authorizationUrl, exchangeCode, fetchProfile, pkceChallenge, stateMatches } from "../auth/oauth/flow";
import { callbackUrl, openClientSecret } from "../auth/oauth/provider";
import { startFlowState, takeFlowState } from "../auth/oauth/state";
import type { OAuthFlowState, OAuthMode } from "../auth/oauth/state";
import { reauthenticate } from "../auth/reauth";
import { nowSec } from "../clock";
import { findProviderById, findProviderBySlug } from "../db/oauth-providers";
import type { OAuthProviderRow } from "../db/oauth-providers";
import { findUserById } from "../db/users";
import type { AppEnv } from "../env";
import { ApiError, notFoundError } from "../errors";
import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND } from "../http-status";
import { requireUser } from "../middleware/auth";
import { parseJsonBody } from "../validate";

// GET /api/auth/oauth/:slug/start?mode=login → 302 到提供方（只用于登录）；
// POST /api/auth/oauth/:slug/link → 绑定：经全局 CSRF 检查、要求再确认，返回 { authorize_url }，前端整页跳转（FIN-A）。
//   绑定不能用 GET：跨站导航就能替已登录用户发起，而 OAuth 登录默认不要求本地 2FA，被绑上的身份等于绕过 2FA 的钥匙。
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

/** 生成流程状态（写进加密 Cookie）并给出提供方授权地址 */
async function beginFlow(c: Context<AppEnv>, provider: OAuthProviderRow, binding: { userId: number; sessionHash: string } | null): Promise<string> {
  const mode: OAuthMode = binding === null ? "login" : "link";
  const flow = await startFlowState(c, {
    providerId: provider.id,
    slug: provider.slug,
    oidc: provider.kind === "oidc",
    mode,
    userId: binding?.userId ?? null,
    sessionHash: binding?.sessionHash ?? null,
  });
  return authorizationUrl(provider, {
    redirectUri: callbackUrl(c.env, provider.slug),
    state: flow.st,
    nonce: flow.nn,
    codeChallenge: await pkceChallenge(flow.cv),
  });
}

authOAuthRoutes.get("/:slug/start", async (c) => {
  if (modeSchema.parse(c.req.query("mode")) === "link") {
    throw new ApiError(HTTP_BAD_REQUEST, "oauth_link_requires_post", "绑定第三方账号请在“账号安全”页发起");
  }
  const provider = await usableProvider(c, c.req.param("slug"));
  if (!provider) return redirectResult(c, "login", "provider_unavailable", null);
  const location = await beginFlow(c, provider, null);
  c.header("Cache-Control", "no-store");
  return c.redirect(location, 302);
});

/**
 * 发起绑定：已登录 + 再确认（口径同添加通行密钥：当前密码或 TOTP；没有密码的账号凭最近登录）。
 * state 绑定到当前用户与会话（流程 Cookie 的 uid / sh），回调时会话必须仍是这一个。
 */
authOAuthRoutes.post("/:slug/link", requireUser, async (c) => {
  const body = await parseJsonBody(c, oauthLinkStartRequestSchema);
  const provider = await usableProvider(c, c.req.param("slug"));
  if (!provider) throw new ApiError(HTTP_NOT_FOUND, "provider_unavailable", "这个第三方登录方式不存在或已停用");
  const { user, session } = c.var.auth;
  const row = await findUserById(c.env.APP_DB, user.id);
  if (!row) throw notFoundError("用户不存在");
  await reauthenticate(c, row, body, { purpose: "oauth_link", allowRecentSession: true });

  const authorizeUrl = await beginFlow(c, provider, { userId: user.id, sessionHash: session.idHash });
  await recordAudit(c, {
    action: AUDIT_ACTIONS.identityLinkStart,
    actorUserId: user.id,
    targetType: "user",
    targetId: user.id,
    detail: { provider: provider.slug },
  });
  const response: OAuthLinkStartResponse = { authorize_url: authorizeUrl };
  return c.json(response);
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
