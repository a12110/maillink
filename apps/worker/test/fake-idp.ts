import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { JWK, CryptoKey as JoseKey } from "jose";
import { vi } from "vitest";
import { sha256, toBase64Url } from "../src/auth/crypto";

// 测试内的本地 IdP：jose 生成 RS256 密钥对与 JWKS，拦截 fetch 模拟发现文档、token、JWKS、userinfo。
// token 端点按真实服务器的方式校验 PKCE（S256）、redirect_uri 与客户端认证。

export const IDP_ISSUER = "https://idp.example.com";
export const CLIENT_ID = "maillink-client";
export const CLIENT_SECRET = "s3cr3t-client-value";

type PendingCode = { challenge: string; nonce: string | null; redirectUri: string; claims: Record<string, unknown> };

export type IdTokenTweaks = {
  iss?: string;
  aud?: string | string[];
  /** 相对当前时间的过期秒数（负数 = 已过期） */
  expiresIn?: number;
  /** 签发时间早于当前多少秒 */
  issuedAgo?: number;
  nonce?: string;
  /** 用另一把同 kid 的私钥签名 */
  wrongKey?: boolean;
  alg?: "RS256" | "HS256";
};

export class FakeIdp {
  readonly codes = new Map<string, PendingCode>();
  readonly requests: Array<{ url: string; method: string; body: string; headers: Headers }> = [];
  tweaks: IdTokenTweaks = {};
  /** userinfo 返回的内容：每次换 token 时设为本次授权的声明 */
  userinfo: Record<string, unknown> = {};
  /** 覆盖某个 URL 的响应（用于发现文档的异常场景） */
  readonly overrides = new Map<string, () => Response>();
  clientAuth: "basic" | "post" = "basic";

  private constructor(
    private readonly privateKey: JoseKey,
    private readonly otherKey: JoseKey,
    private readonly publicJwk: JWK,
  ) {}

  static async create(): Promise<FakeIdp> {
    const main = await generateKeyPair("RS256", { extractable: true });
    const other = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(main.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    return new FakeIdp(main.privateKey, other.privateKey, jwk);
  }

  install(): void {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => this.handle(new Request(input, init)));
  }

  discoveryDocument(): Record<string, unknown> {
    return {
      issuer: IDP_ISSUER,
      authorization_endpoint: `${IDP_ISSUER}/authorize`,
      token_endpoint: `${IDP_ISSUER}/token`,
      userinfo_endpoint: `${IDP_ISSUER}/userinfo`,
      jwks_uri: `${IDP_ISSUER}/jwks`,
      response_types_supported: ["code"],
      scopes_supported: ["openid", "profile", "email"],
      code_challenge_methods_supported: ["S256"],
    };
  }

  /** 模拟用户在 IdP 同意授权：从授权地址取参数、记下授权码，返回回调路径（含 code 与 state） */
  authorize(location: string, claims: Record<string, unknown>, options: { challenge?: string; state?: string } = {}): string {
    const url = new URL(location);
    const params = url.searchParams;
    const code = `code-${this.codes.size + 1}-${crypto.randomUUID()}`;
    this.codes.set(code, {
      challenge: options.challenge ?? params.get("code_challenge") ?? "",
      nonce: params.get("nonce"),
      redirectUri: params.get("redirect_uri") ?? "",
      claims,
    });
    const callback = new URL(params.get("redirect_uri") ?? "");
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", options.state ?? params.get("state") ?? "");
    return `${callback.pathname}${callback.search}`;
  }

  private async signIdToken(pending: PendingCode): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const { tweaks } = this;
    const payload = { ...pending.claims, ...(pending.nonce ? { nonce: tweaks.nonce ?? pending.nonce } : {}) };
    const jwt = new SignJWT(payload)
      .setIssuer(tweaks.iss ?? IDP_ISSUER)
      .setAudience(tweaks.aud ?? CLIENT_ID)
      .setIssuedAt(now - (tweaks.issuedAgo ?? 0))
      .setExpirationTime(now + (tweaks.expiresIn ?? 300));
    if (tweaks.alg === "HS256") return jwt.setProtectedHeader({ alg: "HS256", kid: "k1" }).sign(new TextEncoder().encode(CLIENT_SECRET));
    return jwt.setProtectedHeader({ alg: "RS256", kid: "k1" }).sign(tweaks.wrongKey ? this.otherKey : this.privateKey);
  }

  private clientAuthenticated(request: Request, form: URLSearchParams): boolean {
    if (this.clientAuth === "post") return form.get("client_secret") === CLIENT_SECRET && !request.headers.has("Authorization");
    const expected = `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`;
    return request.headers.get("Authorization") === expected && !form.has("client_secret");
  }

  /** 返回拒绝原因；通过返回 null */
  private async rejectGrant(request: Request, form: URLSearchParams, pending: PendingCode | undefined): Promise<string | null> {
    if (!pending || form.get("grant_type") !== "authorization_code") return "invalid_grant";
    const computed = toBase64Url(await sha256(form.get("code_verifier") ?? ""));
    if (computed !== pending.challenge) return "invalid_grant";
    if (form.get("redirect_uri") !== pending.redirectUri || form.get("client_id") !== CLIENT_ID) return "invalid_grant";
    return this.clientAuthenticated(request, form) ? null : "invalid_client";
  }

  private async token(request: Request, body: string): Promise<Response> {
    const form = new URLSearchParams(body);
    const code = form.get("code") ?? "";
    const pending = this.codes.get(code);
    this.codes.delete(code);
    const rejected = await this.rejectGrant(request, form, pending);
    if (rejected || !pending) return Response.json({ error: rejected }, { status: 400 });
    const idToken = pending.nonce === null ? undefined : await this.signIdToken(pending);
    this.userinfo = { ...pending.claims };
    return Response.json({ access_token: "at-123", token_type: "Bearer", ...(idToken ? { id_token: idToken } : {}) });
  }

  async handle(request: Request): Promise<Response> {
    const body = request.method === "POST" ? new TextDecoder().decode(await request.arrayBuffer()) : "";
    this.requests.push({ url: request.url, method: request.method, body, headers: request.headers });
    const override = this.overrides.get(request.url);
    if (override) return override();
    switch (request.url) {
      case `${IDP_ISSUER}/.well-known/openid-configuration`:
        return Response.json(this.discoveryDocument());
      case `${IDP_ISSUER}/jwks`:
        return Response.json({ keys: [this.publicJwk] });
      case `${IDP_ISSUER}/token`:
        return this.token(request, body);
      case `${IDP_ISSUER}/userinfo`:
        if (request.headers.get("Authorization") !== "Bearer at-123") return new Response("unauthorized", { status: 401 });
        return Response.json(this.userinfo);
      default:
        return new Response(`unexpected fetch ${request.url}`, { status: 599 });
    }
  }
}
