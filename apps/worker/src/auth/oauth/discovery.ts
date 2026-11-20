import { z } from "zod";
import type { OAuthDiscoverResponse } from "@maillink/shared";
import { OutboundError, assertPublicHttpsUrl, fetchJson } from "./outbound";

// OIDC 发现文档（OpenID Connect Discovery 1.0 §4）。只认合法文档：
// issuer 与请求的 issuer 逐字相等；三个必需端点都是可出站的 https 地址；支持 code 响应类型；
// 若声明了 code_challenge_methods_supported，必须包含 S256（本系统一律用 PKCE S256）。

export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryError";
  }
}

const WELL_KNOWN_PATH = "/.well-known/openid-configuration";

const stringList = z.array(z.string()).optional();
const documentSchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  jwks_uri: z.string(),
  userinfo_endpoint: z.string().optional(),
  response_types_supported: z.array(z.string()),
  scopes_supported: stringList,
  code_challenge_methods_supported: stringList,
});

export function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}${WELL_KNOWN_PATH}`;
}

function checkedEndpoint(value: string, field: string): string {
  try {
    return assertPublicHttpsUrl(value).toString();
  } catch (error) {
    if (error instanceof OutboundError) throw new DiscoveryError(`${field} 不可用：${error.message}`);
    throw error;
  }
}

function validateDocument(issuer: string, raw: Record<string, unknown>): OAuthDiscoverResponse {
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) throw new DiscoveryError("不是合法的 OIDC 发现文档：缺少必需字段");
  const doc = parsed.data;
  if (doc.issuer !== issuer) {
    throw new DiscoveryError(`发现文档里的 issuer（${doc.issuer}）与填写的（${issuer}）不一致，请按文档里的值填写`);
  }
  if (!doc.response_types_supported.includes("code")) throw new DiscoveryError("提供方不支持授权码模式");
  const pkce = doc.code_challenge_methods_supported;
  if (pkce && !pkce.includes("S256")) throw new DiscoveryError("提供方不支持 PKCE S256");
  return {
    issuer: doc.issuer,
    authorization_endpoint: checkedEndpoint(doc.authorization_endpoint, "authorization_endpoint"),
    token_endpoint: checkedEndpoint(doc.token_endpoint, "token_endpoint"),
    userinfo_endpoint: doc.userinfo_endpoint ? checkedEndpoint(doc.userinfo_endpoint, "userinfo_endpoint") : null,
    jwks_uri: checkedEndpoint(doc.jwks_uri, "jwks_uri"),
    scopes_supported: doc.scopes_supported ?? null,
  };
}

/** 取回并校验发现文档。地址不合规、网络失败、文档不合法都抛 DiscoveryError，消息可展示给管理员 */
export async function discoverOidc(issuer: string): Promise<OAuthDiscoverResponse> {
  let raw: Record<string, unknown>;
  try {
    assertPublicHttpsUrl(issuer);
    raw = await fetchJson(discoveryUrl(issuer), { headers: { Accept: "application/json" } });
  } catch (error) {
    if (error instanceof OutboundError) throw new DiscoveryError(`无法读取发现文档：${error.message}`);
    throw error;
  }
  return validateDocument(issuer, raw);
}
