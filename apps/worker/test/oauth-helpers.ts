import { env } from "cloudflare:workers";
import type { AdminOAuthProvider, OAuthProviderCreate } from "@maillink/shared";
import { expect } from "vitest";
import { TEST_PASSWORD, api } from "./helpers";
import { CLIENT_ID, CLIENT_SECRET, IDP_ISSUER } from "./fake-idp";
import type { FakeIdp } from "./fake-idp";
import { cookieFrom, joinCookies } from "./security-helpers";

// OAuth 测试共用：建提供方、发起流程、完成回调。

export async function createProvider(
  adminCookie: string,
  overrides: Partial<OAuthProviderCreate> = {},
): Promise<AdminOAuthProvider> {
  const res = await api("/api/admin/oauth-providers", {
    json: {
      slug: "idp",
      name: "Test IdP",
      kind: "oidc",
      issuer: IDP_ISSUER,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      ...overrides,
    },
    cookie: adminCookie,
  });
  if (res.status !== 201) throw new Error(`建提供方失败 ${res.status}: ${await res.text()}`);
  return (await res.json()) as AdminOAuthProvider;
}

export type FlowResult = {
  /** 回前端的结果码（oauth 查询参数） */
  result: string | null;
  location: URL;
  res: Response;
};

export type Started = { authorizeUrl: URL; flowCookie: string };

/** 发起绑定：POST /api/auth/oauth/:slug/link（默认带测试用户的当前密码再确认），返回授权地址与流程 Cookie */
export async function startLink(cookie: string, options: { slug?: string; reauth?: Record<string, string> } = {}): Promise<Started> {
  const res = await api(`/api/auth/oauth/${options.slug ?? "idp"}/link`, { json: options.reauth ?? { password: TEST_PASSWORD }, cookie });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { authorize_url: string };
  return { authorizeUrl: new URL(body.authorize_url), flowCookie: cookieFrom(res, "oauth_flow") ?? "" };
}

async function startLogin(slug: string, cookie: string | undefined): Promise<Started> {
  const res = await api(`/api/auth/oauth/${slug}/start?mode=login`, cookie ? { cookie } : {});
  expect(res.status).toBe(302);
  return { authorizeUrl: new URL(res.headers.get("Location") ?? ""), flowCookie: cookieFrom(res, "oauth_flow") ?? "" };
}

/** 发起 → IdP 同意 → 回调，一次走完。claims 是 IdP 这次签发的声明；link 模式必须给 cookie */
export async function runOAuth(
  idp: FakeIdp,
  claims: Record<string, unknown>,
  options: { slug?: string; mode?: "login" | "link"; cookie?: string; challenge?: string; state?: string } = {},
): Promise<FlowResult & { flowCookie: string; callbackPath: string; authorizeUrl: URL }> {
  const slug = options.slug ?? "idp";
  const { authorizeUrl, flowCookie } =
    options.mode === "link" ? await startLink(options.cookie ?? "", { slug }) : await startLogin(slug, options.cookie);
  const callbackPath = idp.authorize(authorizeUrl.toString(), claims, options);
  const finished = await finishCallback(callbackPath, joinCookies(options.cookie, flowCookie));
  return { ...finished, flowCookie, callbackPath, authorizeUrl };
}

export async function finishCallback(path: string, cookie: string): Promise<FlowResult> {
  const res = await api(path, cookie ? { cookie } : {});
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("Location") ?? "");
  return { res, location, result: location.searchParams.get("oauth") };
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await env.APP_DB
    .prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, 0)")
    .bind(key, JSON.stringify(value))
    .run();
}

export async function identityCount(userId?: number): Promise<number> {
  const statement =
    userId === undefined
      ? env.APP_DB.prepare("SELECT COUNT(*) AS n FROM user_identities")
      : env.APP_DB.prepare("SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?").bind(userId);
  return (await statement.first<{ n: number }>())?.n ?? 0;
}

export async function linkIdentity(userId: number, providerId: number, subject: string): Promise<number> {
  const result = await env.APP_DB
    .prepare("INSERT INTO user_identities (user_id, provider_id, subject, created_at) VALUES (?, ?, ?, 0)")
    .bind(userId, providerId, subject)
    .run();
  return result.meta.last_row_id;
}
