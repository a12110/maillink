import { createLocalJWKSet, errors as joseErrors, jwtVerify } from "jose";
import type { JSONWebKeySet } from "jose";
import { z } from "zod";
import type { OAuthResultCode } from "@maillink/shared";
import { MS_PER_SEC, OAUTH_CLOCK_TOLERANCE_SEC, OAUTH_STATE_SEC } from "../../constants";
import type { OAuthProviderRow } from "../../db/oauth-providers";
import { sha256, timingSafeEqualStrings, toBase64Url } from "../crypto";
import { extractProfile, ProfileError } from "./claims";
import type { OAuthProfile } from "./claims";
import { OutboundError, fetchJson } from "./outbound";
import { parseClaimMap } from "./provider";

// 授权码 + PKCE(S256) 的服务端部分：拼授权地址、换 token、校验 id_token、取 userinfo、按 claim_map 取资料。

/** 流程失败，code 直接作为回前端的结果码；detail 只写日志 */
export class OAuthFlowError extends Error {
  constructor(
    readonly code: Extract<OAuthResultCode, "exchange_failed" | "token_invalid" | "profile_invalid">,
    detail: string,
  ) {
    super(detail);
    this.name = "OAuthFlowError";
  }
}

/** 只接受非对称签名算法：排除 none 与 HS*（HS* 会让持有 client_secret 的任何一方都能签发） */
const ALLOWED_ID_TOKEN_ALGS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"];

export async function pkceChallenge(verifier: string): Promise<string> {
  return toBase64Url(await sha256(verifier));
}

export type AuthorizationParams = { redirectUri: string; state: string; nonce: string | null; codeChallenge: string };

export function authorizationUrl(provider: OAuthProviderRow, params: AuthorizationParams): string {
  if (!provider.authorization_endpoint) throw new Error(`提供方 ${provider.slug} 缺少 authorization_endpoint`);
  const url = new URL(provider.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.client_id);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", provider.scopes);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (params.nonce !== null) url.searchParams.set("nonce", params.nonce);
  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  id_token: z.string().min(1).optional(),
});
type TokenResponse = z.infer<typeof tokenResponseSchema>;

function wrapOutbound<T>(code: OAuthFlowError["code"], operation: Promise<T>): Promise<T> {
  return operation.catch((error: unknown) => {
    if (error instanceof OutboundError) throw new OAuthFlowError(code, `${error.failure}: ${error.message}`);
    throw error;
  });
}

/**
 * 用授权码换 token。客户端认证：oidc 用 client_secret_basic（OIDC 默认），oauth2 用 client_secret_post
 * （GitHub 等常见 OAuth2 提供方的用法）；两者不同时发送（RFC 6749 §2.3）。
 */
export async function exchangeCode(
  provider: OAuthProviderRow,
  clientSecret: string,
  input: { code: string; codeVerifier: string; redirectUri: string },
): Promise<TokenResponse> {
  if (!provider.token_endpoint) throw new Error(`提供方 ${provider.slug} 缺少 token_endpoint`);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    client_id: provider.client_id,
  });
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (provider.kind === "oidc") {
    const basic = `${encodeURIComponent(provider.client_id)}:${encodeURIComponent(clientSecret)}`;
    headers.Authorization = `Basic ${btoa(basic)}`;
  } else {
    body.set("client_secret", clientSecret);
  }
  const raw = await wrapOutbound("exchange_failed", fetchJson(provider.token_endpoint, { method: "POST", headers, body }));
  const parsed = tokenResponseSchema.safeParse(raw);
  if (!parsed.success) throw new OAuthFlowError("exchange_failed", "token 响应缺少 access_token");
  return parsed.data;
}

async function loadJwks(provider: OAuthProviderRow): Promise<ReturnType<typeof createLocalJWKSet>> {
  if (!provider.jwks_uri) throw new Error(`提供方 ${provider.slug} 缺少 jwks_uri`);
  const raw = await wrapOutbound("token_invalid", fetchJson(provider.jwks_uri, { headers: { Accept: "application/json" } }));
  try {
    return createLocalJWKSet(raw as unknown as JSONWebKeySet);
  } catch (error) {
    throw new OAuthFlowError("token_invalid", `JWKS 无效：${String(error)}`);
  }
}

/** 用 JWKS 校验 id_token 的签名、iss、aud、exp（含 nbf/iat、签发不早于流程有效期）与 nonce；azp 出现时必须是 client_id */
export async function verifyIdToken(
  provider: OAuthProviderRow,
  idToken: string,
  nonce: string,
  nowSec: number,
): Promise<Record<string, unknown>> {
  if (!provider.issuer) throw new Error(`提供方 ${provider.slug} 缺少 issuer`);
  const jwks = await loadJwks(provider);
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(idToken, jwks, {
      issuer: provider.issuer,
      audience: provider.client_id,
      algorithms: ALLOWED_ID_TOKEN_ALGS,
      clockTolerance: OAUTH_CLOCK_TOLERANCE_SEC,
      currentDate: new Date(nowSec * MS_PER_SEC),
      // 签发时间早于整个流程有效期的 id_token 不可能属于本次流程
      maxTokenAge: OAUTH_STATE_SEC,
      requiredClaims: ["exp", "iat", "sub"],
    }));
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) throw new OAuthFlowError("token_invalid", `${error.code}: ${error.message}`);
    throw error;
  }
  const given = typeof payload.nonce === "string" ? payload.nonce : "";
  if (!(await timingSafeEqualStrings(given, nonce))) throw new OAuthFlowError("token_invalid", "nonce 不符");
  // azp 只要出现就必须是本客户端（OIDC Core §3.1.3.7）
  if (payload.azp !== undefined && payload.azp !== provider.client_id) {
    throw new OAuthFlowError("token_invalid", "id_token 的 azp 不是本客户端");
  }
  return payload;
}

async function fetchUserinfo(provider: OAuthProviderRow, accessToken: string): Promise<Record<string, unknown>> {
  if (!provider.userinfo_endpoint) throw new Error(`提供方 ${provider.slug} 缺少 userinfo_endpoint`);
  return wrapOutbound(
    "profile_invalid",
    fetchJson(provider.userinfo_endpoint, {
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}`, "User-Agent": "MailLink" },
    }),
  );
}

/**
 * 取用户资料。oidc：以校验过的 id_token 声明为准；配置了 userinfo 时补充 id_token 里没有的声明，
 * 且 userinfo 的 sub 必须与 id_token 一致（OIDC Core §5.3.2）。oauth2：只能用 userinfo。
 */
export async function fetchProfile(
  provider: OAuthProviderRow,
  tokens: TokenResponse,
  nonce: string | null,
  nowSec: number,
): Promise<OAuthProfile> {
  let claims: Record<string, unknown>;
  if (provider.kind === "oidc") {
    if (!tokens.id_token || nonce === null) throw new OAuthFlowError("token_invalid", "缺少 id_token");
    const idClaims = await verifyIdToken(provider, tokens.id_token, nonce, nowSec);
    claims = idClaims;
    if (provider.userinfo_endpoint) {
      const info = await fetchUserinfo(provider, tokens.access_token);
      if (info.sub !== idClaims.sub) throw new OAuthFlowError("profile_invalid", "userinfo 的 sub 与 id_token 不一致");
      claims = { ...info, ...idClaims };
    }
  } else {
    claims = await fetchUserinfo(provider, tokens.access_token);
  }
  try {
    return extractProfile(claims, parseClaimMap(provider));
  } catch (error) {
    if (error instanceof ProfileError) throw new OAuthFlowError("profile_invalid", error.message);
    throw error;
  }
}

export function stateMatches(given: string, expected: string): Promise<boolean> {
  return timingSafeEqualStrings(given, expected);
}
