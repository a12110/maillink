import type { OAuthProviderKind } from "@maillink/shared";
import { loadLoginMethodFlags } from "./login-methods";

// oauth_providers。client_secret_enc 是 secret-box 密文，只有 auth/oauth/provider-secret.ts 解密。

export type OAuthProviderRow = {
  id: number;
  slug: string;
  name: string;
  kind: OAuthProviderKind;
  enabled: number;
  issuer: string | null;
  authorization_endpoint: string | null;
  token_endpoint: string | null;
  userinfo_endpoint: string | null;
  jwks_uri: string | null;
  client_id: string;
  client_secret_enc: string;
  scopes: string;
  /** JSON 文本 */
  claim_map: string;
  allow_signup: number;
  auto_link_verified_email: number;
  icon: string | null;
  sort: number;
  created_at: number;
  updated_at: number;
};

export type ProviderValues = Omit<OAuthProviderRow, "id" | "created_at" | "updated_at">;

const COLUMNS = `id, slug, name, kind, enabled, issuer, authorization_endpoint, token_endpoint, userinfo_endpoint,
  jwks_uri, client_id, client_secret_enc, scopes, claim_map, allow_signup, auto_link_verified_email, icon, sort,
  created_at, updated_at`;

const WRITABLE: Array<keyof ProviderValues> = [
  "slug",
  "name",
  "kind",
  "enabled",
  "issuer",
  "authorization_endpoint",
  "token_endpoint",
  "userinfo_endpoint",
  "jwks_uri",
  "client_id",
  "client_secret_enc",
  "scopes",
  "claim_map",
  "allow_signup",
  "auto_link_verified_email",
  "icon",
  "sort",
];

export async function listProviders(db: D1Database): Promise<OAuthProviderRow[]> {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM oauth_providers ORDER BY sort, id`).all<OAuthProviderRow>();
  return results;
}

export async function listEnabledProviders(db: D1Database): Promise<OAuthProviderRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM oauth_providers WHERE enabled = 1 ORDER BY sort, id`)
    .all<OAuthProviderRow>();
  return results;
}

export function findProviderById(db: D1Database, id: number): Promise<OAuthProviderRow | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM oauth_providers WHERE id = ?`).bind(id).first<OAuthProviderRow>();
}

export function findProviderBySlug(db: D1Database, slug: string): Promise<OAuthProviderRow | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM oauth_providers WHERE slug = ?`).bind(slug).first<OAuthProviderRow>();
}

/** slug 重复时抛 D1 唯一约束错误 */
export async function insertProvider(db: D1Database, values: ProviderValues, now: number): Promise<number> {
  const placeholders = WRITABLE.map(() => "?").join(", ");
  const result = await db
    .prepare(`INSERT INTO oauth_providers (${WRITABLE.join(", ")}, created_at, updated_at) VALUES (${placeholders}, ?, ?)`)
    .bind(...WRITABLE.map((key) => values[key]), now, now)
    .run();
  return result.meta.last_row_id;
}

export async function updateProvider(db: D1Database, id: number, values: ProviderValues, now: number): Promise<boolean> {
  const sets = WRITABLE.map((key) => `${key} = ?`).join(", ");
  const result = await db
    .prepare(`UPDATE oauth_providers SET ${sets}, updated_at = ? WHERE id = ?`)
    .bind(...WRITABLE.map((key) => values[key]), now, id)
    .run();
  return result.meta.changes === 1;
}

export async function countProviderIdentities(db: D1Database, providerId: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM user_identities WHERE provider_id = ?")
    .bind(providerId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 删除提供方（外键级联删除其全部绑定）。返回 false 表示不存在 */
export async function deleteProvider(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM oauth_providers WHERE id = ?").bind(id).run();
  // 级联删除的绑定也计入 changes，不能和 1 比较
  return result.meta.changes > 0;
}

/**
 * 绑定了该提供方、且除它之外没有任何开放中的登录方式的用户（不算这个提供方的绑定；
 * 规则同 login-methods.ts，只算 auth.login_methods 开放的方式）。删除前或停用后调用，提示管理员为这些用户设置密码。
 */
export async function usersOnlyLoggingInVia(db: D1Database, providerId: number): Promise<number[]> {
  const flags = await loadLoginMethodFlags(db);
  const { results } = await db
    .prepare(
      `SELECT DISTINCT i.user_id AS id FROM user_identities i
       WHERE i.provider_id = ?
         AND NOT (? = 1 AND EXISTS (SELECT 1 FROM users u WHERE u.id = i.user_id AND u.password_hash IS NOT NULL))
         AND NOT (? = 1 AND EXISTS (SELECT 1 FROM user_passkeys p WHERE p.user_id = i.user_id))
         AND NOT (? = 1 AND EXISTS (SELECT 1 FROM user_identities j JOIN oauth_providers o ON o.id = j.provider_id
                                    WHERE j.user_id = i.user_id AND j.provider_id <> ? AND o.enabled = 1))
       ORDER BY i.user_id`,
    )
    .bind(providerId, flags.password ? 1 : 0, flags.passkey ? 1 : 0, flags.oauth ? 1 : 0, providerId)
    .all<{ id: number }>();
  return results.map((row) => row.id);
}
