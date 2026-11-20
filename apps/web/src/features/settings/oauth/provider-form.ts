import {
  DEFAULT_CLAIM_MAP,
  DEFAULT_OIDC_SCOPES,
  oauthProviderCreateSchema,
  oauthProviderUpdateSchema,
} from "@maillink/shared";
import type { AdminOAuthProvider, OAuthProviderCreate, OAuthProviderKind, OAuthProviderUpdate } from "@maillink/shared";
import type { z } from "zod";
import { toNumber } from "../form-model";

// OAuth 提供方对话框的草稿 ↔ 接口数据。claim_map 的四项拍平成 claim_* 字段，数字与可空串都用字符串编辑。

export type ProviderDraft = {
  slug: string;
  name: string;
  kind: OAuthProviderKind;
  enabled: boolean;
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  client_id: string;
  /** 编辑时留空表示不改 */
  client_secret: string;
  scopes: string;
  claim_subject: string;
  claim_email: string;
  claim_email_verified: string;
  claim_name: string;
  allow_signup: boolean;
  auto_link_verified_email: boolean;
  icon: string;
  sort: string;
};

export function emptyDraft(): ProviderDraft {
  return {
    slug: "", name: "", kind: "oidc", enabled: true,
    issuer: "", authorization_endpoint: "", token_endpoint: "", userinfo_endpoint: "", jwks_uri: "",
    client_id: "", client_secret: "", scopes: DEFAULT_OIDC_SCOPES,
    claim_subject: DEFAULT_CLAIM_MAP.subject,
    claim_email: DEFAULT_CLAIM_MAP.email ?? "",
    claim_email_verified: DEFAULT_CLAIM_MAP.email_verified ?? "",
    claim_name: DEFAULT_CLAIM_MAP.name ?? "",
    allow_signup: false, auto_link_verified_email: false, icon: "", sort: "0",
  };
}

export function draftFromProvider(provider: AdminOAuthProvider): ProviderDraft {
  return {
    slug: provider.slug, name: provider.name, kind: provider.kind, enabled: provider.enabled,
    issuer: provider.issuer ?? "",
    authorization_endpoint: provider.authorization_endpoint ?? "",
    token_endpoint: provider.token_endpoint ?? "",
    userinfo_endpoint: provider.userinfo_endpoint ?? "",
    jwks_uri: provider.jwks_uri ?? "",
    client_id: provider.client_id, client_secret: "", scopes: provider.scopes,
    claim_subject: provider.claim_map.subject,
    claim_email: provider.claim_map.email ?? "",
    claim_email_verified: provider.claim_map.email_verified ?? "",
    claim_name: provider.claim_map.name ?? "",
    allow_signup: provider.allow_signup, auto_link_verified_email: provider.auto_link_verified_email,
    icon: provider.icon ?? "", sort: String(provider.sort),
  };
}

export type ProviderParse<I> = { ok: true; value: I } | { ok: false; fields: Record<string, string> };

const nullable = (text: string): string | null => (text.trim() === "" ? null : text.trim());

const REQUIRED_MESSAGES: ReadonlyArray<[keyof ProviderDraft, string]> = [
  ["slug", "请填写 slug"],
  ["name", "请填写名称"],
  ["client_id", "请填写 client_id"],
  ["claim_subject", "请填写 subject 的 claim 路径（通常是 sub）"],
];

/** 按类型必填：OIDC 要 issuer，OAuth2 要三个端点与 scopes */
function missingByKind(draft: ProviderDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.kind === "oidc") {
    if (draft.issuer.trim() === "") errors.issuer = "OIDC 提供方需要填写 issuer";
    return errors;
  }
  for (const field of ["authorization_endpoint", "token_endpoint", "userinfo_endpoint"] as const) {
    if (draft[field].trim() === "") errors[field] = "OAuth2 提供方需要填写这个端点";
  }
  if (draft.scopes.trim() === "") errors.scopes = "OAuth2 提供方需要填写 scopes";
  return errors;
}

/** 必填与按类型必填的检查：用中文就地说明，不交给 schema 产生英文“Too small” */
function missingFields(draft: ProviderDraft, mode: "create" | "edit"): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [field, message] of REQUIRED_MESSAGES) {
    if (String(draft[field]).trim() === "") errors[field] = message;
  }
  if (mode === "create" && draft.client_secret === "") errors.client_secret = "请填写 client_secret";
  return { ...errors, ...missingByKind(draft) };
}

/** zod 路径 → 草稿字段名 */
function fieldOfPath(path: ReadonlyArray<PropertyKey>): string {
  if (path[0] === "claim_map") return `claim_${String(path[1] ?? "subject")}`;
  return String(path[0] ?? "form");
}

function rawBody(draft: ProviderDraft, sort: number) {
  return {
    slug: draft.slug, name: draft.name, kind: draft.kind, enabled: draft.enabled,
    issuer: nullable(draft.issuer),
    authorization_endpoint: nullable(draft.authorization_endpoint),
    token_endpoint: nullable(draft.token_endpoint),
    userinfo_endpoint: nullable(draft.userinfo_endpoint),
    jwks_uri: nullable(draft.jwks_uri),
    client_id: draft.client_id,
    scopes: nullable(draft.scopes),
    claim_map: {
      subject: draft.claim_subject,
      email: nullable(draft.claim_email),
      email_verified: nullable(draft.claim_email_verified),
      name: nullable(draft.claim_name),
    },
    allow_signup: draft.allow_signup,
    auto_link_verified_email: draft.auto_link_verified_email,
    icon: nullable(draft.icon),
    sort,
  };
}

function parseWith<S extends z.ZodType>(schema: S, raw: unknown): ProviderParse<z.output<S>> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[fieldOfPath(issue.path)] ??= issue.message;
  return { ok: false, fields };
}

/** 新建：client_secret 必填 */
export function toCreateInput(draft: ProviderDraft): ProviderParse<OAuthProviderCreate> {
  const missing = missingFields(draft, "create");
  const sort = toNumber(draft.sort);
  if (sort === null) missing.sort = "请输入整数";
  if (Object.keys(missing).length > 0) return { ok: false, fields: missing };
  return parseWith(oauthProviderCreateSchema, { ...rawBody(draft, sort ?? 0), client_secret: draft.client_secret });
}

/** 编辑（PUT 整体替换）：client_secret 留空就不带，服务端保留原值 */
export function toUpdateInput(draft: ProviderDraft): ProviderParse<OAuthProviderUpdate> {
  const missing = missingFields(draft, "edit");
  const sort = toNumber(draft.sort);
  if (sort === null) missing.sort = "请输入整数";
  if (Object.keys(missing).length > 0) return { ok: false, fields: missing };
  const body = rawBody(draft, sort ?? 0);
  return parseWith(oauthProviderUpdateSchema, draft.client_secret === "" ? body : { ...body, client_secret: draft.client_secret });
}
