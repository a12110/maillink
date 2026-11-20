import { Hono } from "hono";
import type { Context } from "hono";
import {
  DEFAULT_OIDC_SCOPES,
  oauthDiscoverRequestSchema,
  oauthProviderCreateSchema,
  oauthProviderUpdateSchema,
} from "@maillink/shared";
import type { AdminOAuthProvider, OAuthProviderChangeResponse } from "@maillink/shared";
import type { z } from "zod";
import { AUDIT_ACTIONS, recordAudit } from "../audit";
import { DiscoveryError, discoverOidc } from "../auth/oauth/discovery";
import { OutboundError, assertPublicHttpsUrl } from "../auth/oauth/outbound";
import { callbackUrl, parseClaimMap, sealClientSecret } from "../auth/oauth/provider";
import { nowSec } from "../clock";
import { uniqueViolationTarget } from "../db/errors";
import {
  countProviderIdentities,
  deleteProvider,
  findProviderById,
  insertProvider,
  listProviders,
  updateProvider,
  usersOnlyLoggingInVia,
} from "../db/oauth-providers";
import type { OAuthProviderRow, ProviderValues } from "../db/oauth-providers";
import type { AppEnv } from "../env";
import { ApiError, notFoundError } from "../errors";
import { HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_CREATED, HTTP_UNPROCESSABLE } from "../http-status";
import { parseIdParam, parseJsonBody } from "../validate";

// /api/admin/oauth-providers（管理员，04 设置/oauth-providers）。client_secret 加密存储、从不回显。
// oidc 未填端点时服务端按 issuer 读取发现文档补齐；所有端点都要过出站地址检查（防 SSRF）。

export const adminOAuthProviderRoutes = new Hono<AppEnv>();

type ProviderInput = z.output<typeof oauthProviderUpdateSchema>;
type Endpoints = Pick<ProviderValues, "issuer" | "authorization_endpoint" | "token_endpoint" | "userinfo_endpoint" | "jwks_uri">;

function invalid(message: string): ApiError {
  return new ApiError(HTTP_BAD_REQUEST, "oauth_provider_invalid", message);
}

function toAdminProvider(c: Context<AppEnv>, row: OAuthProviderRow): AdminOAuthProvider {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    enabled: row.enabled === 1,
    issuer: row.issuer,
    authorization_endpoint: row.authorization_endpoint,
    token_endpoint: row.token_endpoint,
    userinfo_endpoint: row.userinfo_endpoint,
    jwks_uri: row.jwks_uri,
    client_id: row.client_id,
    client_secret_set: row.client_secret_enc !== "",
    scopes: row.scopes,
    claim_map: parseClaimMap(row),
    allow_signup: row.allow_signup === 1,
    auto_link_verified_email: row.auto_link_verified_email === 1,
    icon: row.icon,
    sort: row.sort,
    callback_url: callbackUrl(c.env, row.slug),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function checkedUrl(value: string | null, field: string): string | null {
  if (value === null) return null;
  try {
    return assertPublicHttpsUrl(value).toString();
  } catch (error) {
    if (error instanceof OutboundError) throw new ApiError(HTTP_BAD_REQUEST, "oauth_url_rejected", `${field}：${error.message}`);
    throw error;
  }
}

async function discover(issuer: string) {
  checkedUrl(issuer, "issuer");
  try {
    return await discoverOidc(issuer);
  } catch (error) {
    if (error instanceof DiscoveryError) throw new ApiError(HTTP_UNPROCESSABLE, "oauth_discovery_failed", error.message);
    throw error;
  }
}

function oauth2Endpoints(input: ProviderInput): Endpoints {
  if (!input.authorization_endpoint || !input.token_endpoint || !input.userinfo_endpoint) {
    throw invalid("oauth2 提供方需要 authorization_endpoint、token_endpoint 与 userinfo_endpoint");
  }
  return { ...input, issuer: null, jwks_uri: null };
}

/** oidc：三个必需端点有缺的就读发现文档补齐（已填的保留） */
async function oidcEndpoints(input: ProviderInput): Promise<Endpoints> {
  if (!input.issuer) throw invalid("oidc 提供方需要 issuer");
  if (input.authorization_endpoint && input.token_endpoint && input.jwks_uri) return input;
  const doc = await discover(input.issuer);
  return {
    issuer: input.issuer,
    authorization_endpoint: input.authorization_endpoint ?? doc.authorization_endpoint,
    token_endpoint: input.token_endpoint ?? doc.token_endpoint,
    userinfo_endpoint: input.userinfo_endpoint ?? doc.userinfo_endpoint,
    jwks_uri: input.jwks_uri ?? doc.jwks_uri,
  };
}

async function resolveEndpoints(input: ProviderInput): Promise<Endpoints> {
  const endpoints = input.kind === "oauth2" ? oauth2Endpoints(input) : await oidcEndpoints(input);
  return {
    issuer: checkedUrl(endpoints.issuer, "issuer") === null ? null : endpoints.issuer,
    authorization_endpoint: checkedUrl(endpoints.authorization_endpoint, "authorization_endpoint"),
    token_endpoint: checkedUrl(endpoints.token_endpoint, "token_endpoint"),
    userinfo_endpoint: checkedUrl(endpoints.userinfo_endpoint, "userinfo_endpoint"),
    jwks_uri: checkedUrl(endpoints.jwks_uri, "jwks_uri"),
  };
}

function resolveScopes(input: ProviderInput): string {
  if (input.kind === "oauth2") {
    if (!input.scopes) throw invalid("oauth2 提供方需要填写 scopes");
    return input.scopes;
  }
  const scopes = input.scopes ?? DEFAULT_OIDC_SCOPES;
  if (!scopes.split(/\s+/).includes("openid")) throw invalid("oidc 提供方的 scopes 必须包含 openid");
  return scopes;
}

async function buildValues(c: Context<AppEnv>, input: ProviderInput, keptSecretEnc: string | null): Promise<ProviderValues> {
  const secretEnc = input.client_secret === undefined ? keptSecretEnc : await sealClientSecret(c.env, input.client_secret);
  if (secretEnc === null) throw invalid("需要填写 client_secret");
  return {
    ...(await resolveEndpoints(input)),
    slug: input.slug,
    name: input.name,
    kind: input.kind,
    enabled: input.enabled ? 1 : 0,
    client_id: input.client_id,
    client_secret_enc: secretEnc,
    scopes: resolveScopes(input),
    claim_map: JSON.stringify(input.claim_map),
    allow_signup: input.allow_signup ? 1 : 0,
    auto_link_verified_email: input.auto_link_verified_email ? 1 : 0,
    icon: input.icon,
    sort: input.sort,
  };
}

async function mapSlugConflict<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (uniqueViolationTarget(error) === "oauth_providers.slug") {
      throw new ApiError(HTTP_CONFLICT, "oauth_slug_taken", "slug 已被其他提供方使用");
    }
    throw error;
  }
}

async function requireProvider(db: D1Database, id: number): Promise<OAuthProviderRow> {
  const row = await findProviderById(db, id);
  if (!row) throw notFoundError("提供方不存在");
  return row;
}

/** 审计里只记非秘密字段 */
function auditSnapshot(values: Pick<ProviderValues, "slug" | "kind" | "enabled" | "allow_signup" | "auto_link_verified_email">) {
  return {
    slug: values.slug,
    kind: values.kind,
    enabled: values.enabled === 1,
    allow_signup: values.allow_signup === 1,
    auto_link_verified_email: values.auto_link_verified_email === 1,
  };
}

/** 决定"同一个 subject 是不是同一个人"的字段：换了它们就可能换成另一个 IdP */
const IDENTITY_FIELDS = [
  "kind",
  "issuer",
  "authorization_endpoint",
  "token_endpoint",
  "userinfo_endpoint",
  "jwks_uri",
  "client_id",
] as const satisfies ReadonlyArray<keyof ProviderValues>;

/**
 * 已有绑定时不允许改身份相关字段：(provider_id, subject) 是绑定的唯一键，换成另一个 IdP 后
 * 同一个 subject 可能是另一个人，会直接登录进原绑定的账号。被拒的修改也写审计。
 */
async function assertIdentityFieldsStable(c: Context<AppEnv>, before: OAuthProviderRow, values: ProviderValues): Promise<void> {
  const changed = IDENTITY_FIELDS.filter((field) => before[field] !== values[field]);
  if (changed.length === 0) return;
  const identities = await countProviderIdentities(c.env.APP_DB, before.id);
  if (identities === 0) return;
  await recordAudit(c, {
    action: AUDIT_ACTIONS.oauthProviderUpdateRejected,
    actorUserId: c.var.auth.user.id,
    targetType: "oauth_provider",
    targetId: before.id,
    detail: { slug: before.slug, changed, identities, reason: "has_identities" },
  });
  throw new ApiError(
    HTTP_CONFLICT,
    "oauth_provider_has_identities",
    `该提供方已有 ${identities} 个绑定，修改 ${changed.join("、")} 前需先解除这些绑定（或删除提供方后重建）`,
  );
}

adminOAuthProviderRoutes.get("/", async (c) => {
  const rows = await listProviders(c.env.APP_DB);
  return c.json({ items: rows.map((row) => toAdminProvider(c, row)) });
});

adminOAuthProviderRoutes.post("/discover", async (c) => {
  const body = await parseJsonBody(c, oauthDiscoverRequestSchema);
  return c.json(await discover(body.issuer));
});

adminOAuthProviderRoutes.get("/:id", async (c) => {
  return c.json(toAdminProvider(c, await requireProvider(c.env.APP_DB, parseIdParam(c))));
});

adminOAuthProviderRoutes.post("/", async (c) => {
  const db = c.env.APP_DB;
  const body = await parseJsonBody(c, oauthProviderCreateSchema);
  const values = await buildValues(c, body, null);
  const id = await mapSlugConflict(insertProvider(db, values, nowSec()));
  await recordAudit(c, {
    action: AUDIT_ACTIONS.oauthProviderCreate,
    actorUserId: c.var.auth.user.id,
    targetType: "oauth_provider",
    targetId: id,
    detail: auditSnapshot(values),
  });
  return c.json(toAdminProvider(c, await requireProvider(db, id)), HTTP_CREATED);
});

adminOAuthProviderRoutes.put("/:id", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const body = await parseJsonBody(c, oauthProviderUpdateSchema);
  const before = await requireProvider(db, id);
  const values = await buildValues(c, body, before.client_secret_enc);
  await assertIdentityFieldsStable(c, before, values);
  if (!(await mapSlugConflict(updateProvider(db, id, values, nowSec())))) throw notFoundError("提供方不存在");
  const after = await requireProvider(db, id);
  // 停用后，只靠这个提供方登录的用户就没有登录方式了
  const stranded = after.enabled === 1 ? [] : await usersOnlyLoggingInVia(db, id);
  await recordAudit(c, {
    action: AUDIT_ACTIONS.oauthProviderUpdate,
    actorUserId: c.var.auth.user.id,
    targetType: "oauth_provider",
    targetId: id,
    detail: {
      before: auditSnapshot(before),
      after: auditSnapshot(values),
      client_secret_changed: body.client_secret !== undefined,
      users_without_login_method: stranded,
    },
  });
  const response: OAuthProviderChangeResponse = { provider: toAdminProvider(c, after), users_without_login_method: stranded };
  return c.json(response);
});

adminOAuthProviderRoutes.delete("/:id", async (c) => {
  const db = c.env.APP_DB;
  const id = parseIdParam(c);
  const before = await requireProvider(db, id);
  // 删除会级联删掉全部绑定，先算出删后没有登录方式的用户
  const stranded = await usersOnlyLoggingInVia(db, id);
  if (!(await deleteProvider(db, id))) throw notFoundError("提供方不存在");
  await recordAudit(c, {
    action: AUDIT_ACTIONS.oauthProviderDelete,
    actorUserId: c.var.auth.user.id,
    targetType: "oauth_provider",
    targetId: id,
    detail: { ...auditSnapshot(before), users_without_login_method: stranded },
  });
  const response: OAuthProviderChangeResponse = { provider: null, users_without_login_method: stranded };
  return c.json(response);
});
