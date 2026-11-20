import type { AdminUser, AdminUserList, AdminUserListQuery } from "@maillink/shared";
import { LIST_PAGE_SIZE } from "../constants";

// 管理端用户列表 / 详情：带登录方式标记与授权邮箱数的聚合查询。

type AdminUserRow = {
  id: number;
  username: string;
  display_name: string | null;
  email_lc: string | null;
  role: AdminUser["role"];
  status: AdminUser["status"];
  created_at: number;
  last_login_at: number | null;
  has_password: number;
  totp_enabled: number;
  passkey_count: number;
  grant_count: number;
  oauth_slugs: string;
};

// 登录方式标记从对应表计算：通行密钥、OAuth 绑定、授权邮箱各一个相关子查询
const SELECT_ADMIN_USERS = `
  SELECT u.id, u.username, u.display_name, u.email_lc, u.role, u.status, u.created_at, u.last_login_at,
    u.password_hash IS NOT NULL AS has_password,
    u.totp_enabled_at IS NOT NULL AS totp_enabled,
    (SELECT COUNT(*) FROM user_passkeys p WHERE p.user_id = u.id) AS passkey_count,
    (SELECT COUNT(*) FROM user_mailbox_grants g WHERE g.user_id = u.id) AS grant_count,
    (SELECT json_group_array(o.slug) FROM user_identities i
       JOIN oauth_providers o ON o.id = i.provider_id WHERE i.user_id = u.id) AS oauth_slugs
  FROM users u`;

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    email: row.email_lc,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    login_methods: {
      password: row.has_password === 1,
      totp: row.totp_enabled === 1,
      passkey_count: row.passkey_count,
      oauth_providers: JSON.parse(row.oauth_slugs) as string[],
    },
    mailbox_grant_count: row.grant_count,
  };
}

/** 转义 LIKE 通配符，配合 `ESCAPE '\'` 使用 */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const KEYWORD_CLAUSE = `(u.username_lc LIKE ? ESCAPE '\\' OR u.email_lc LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')`;

function buildFilter(query: AdminUserListQuery, withCursor: boolean): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.q) {
    const pattern = `%${escapeLike(query.q.toLowerCase())}%`;
    clauses.push(KEYWORD_CLAUSE);
    params.push(pattern, pattern, pattern);
  }
  if (query.role) {
    clauses.push("u.role = ?");
    params.push(query.role);
  }
  if (query.status) {
    clauses.push("u.status = ?");
    params.push(query.status);
  }
  if (withCursor && query.cursor) {
    clauses.push("u.id < ?");
    params.push(Number(query.cursor));
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

/** 按 id 倒序（新用户在前）的游标分页；cursor 是上一页最后一条的 id。total 为满足筛选条件的总数，与本页同一 batch */
export async function listAdminUsers(db: D1Database, query: AdminUserListQuery): Promise<AdminUserList> {
  const limit = query.limit ?? LIST_PAGE_SIZE;
  const page = buildFilter(query, true);
  const count = buildFilter(query, false);
  const [list, total] = await db.batch<AdminUserRow | { total: number }>([
    db.prepare(`${SELECT_ADMIN_USERS} ${page.where} ORDER BY u.id DESC LIMIT ?`).bind(...page.params, limit + 1),
    db.prepare(`SELECT COUNT(*) AS total FROM users u ${count.where}`).bind(...count.params),
  ]);
  const results = (list?.results ?? []) as AdminUserRow[];
  const items = results.slice(0, limit).map(toAdminUser);
  const hasMore = results.length > limit;
  const totalRow = total?.results[0] as { total: number } | undefined;
  return { items, next_cursor: hasMore ? String(items[items.length - 1]?.id) : null, total: totalRow?.total ?? 0 };
}

export async function findAdminUser(db: D1Database, id: number): Promise<AdminUser | null> {
  const row = await db.prepare(`${SELECT_ADMIN_USERS} WHERE u.id = ?`).bind(id).first<AdminUserRow>();
  return row ? toAdminUser(row) : null;
}
