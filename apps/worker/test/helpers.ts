import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from "@maillink/shared";
import type { UserRole, UserStatus } from "@maillink/shared";
import { sha256Hex, toBase64Url, randomBytes } from "../src/auth/crypto";
import { hashPassword } from "../src/auth/password";
import { insertSession } from "../src/db/sessions";
import { insertUser } from "../src/db/users";
import type { Bindings } from "../src/env";
import { app } from "../src/index";
import { resetMailSchemaCache } from "../src/mail-source";

// 测试里需要的 MAIL_DB 表结构。测试是允许写本地 MAIL_DB 的（与种子脚本同理），src/mail-source 不是。
// 列定义取自 cloudflare_temp_email 的 db/schema.sql。

const RAW_MAILS_FULL_COLUMNS = [
  "id INTEGER PRIMARY KEY",
  "message_id TEXT",
  "source TEXT",
  "address TEXT",
  "to_address TEXT",
  "raw TEXT",
  "raw_blob BLOB",
  "metadata TEXT",
  "is_unread INTEGER",
  "created_at DATETIME DEFAULT CURRENT_TIMESTAMP",
];

const SETTINGS_DDL =
  "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)";

export type MailDbShape = {
  /** 需要从完整列集合里去掉的列 */
  omitColumns?: string[];
  /** false 时不建 raw_mails 表 */
  rawMails?: boolean;
  /** settings.db_version；null 表示不写这一行 */
  dbVersion?: string | null;
};

/** 把 MAIL_DB 重建为指定形态（并清掉 isolate 内的探测缓存） */
export async function setupMailDb(shape: MailDbShape = {}): Promise<void> {
  const { omitColumns = [], rawMails = true, dbVersion = "v0.0.11" } = shape;
  const db = env.MAIL_DB;
  await db.batch([
    db.prepare("DROP TABLE IF EXISTS raw_mails"),
    db.prepare("DROP TABLE IF EXISTS settings"),
  ]);
  if (rawMails) {
    const columns = RAW_MAILS_FULL_COLUMNS.filter(
      (definition) => !omitColumns.includes(definition.split(" ")[0] ?? ""),
    );
    await db.prepare(`CREATE TABLE raw_mails (${columns.join(", ")})`).run();
  }
  await db.prepare(SETTINGS_DDL).run();
  if (dbVersion !== null) {
    await db.prepare("INSERT INTO settings (key, value) VALUES ('db_version', ?1)").bind(dbVersion).run();
  }
  resetMailSchemaCache();
}

/** 清空两个库、重新执行 APP_DB 迁移，并建好 MAIL_DB 表结构 */
export async function resetApp(): Promise<void> {
  await reset();
  await applyD1Migrations(env.APP_DB, env.TEST_MIGRATIONS);
  await setupMailDb();
}

export const TEST_PASSWORD = "correct-horse-battery";

export type TestUserInput = {
  username: string;
  password?: string;
  role?: UserRole;
  status?: UserStatus;
  email?: string | null;
};

/** 直接写库建用户（绕过 API，便于搭建场景） */
export async function createUser(input: TestUserInput): Promise<number> {
  return insertUser(
    env.APP_DB,
    {
      username: input.username,
      display_name: null,
      email: input.email ?? null,
      role: input.role ?? "user",
      status: input.status ?? "active",
      password_hash: await hashPassword(env, input.password ?? TEST_PASSWORD),
    },
    Math.floor(Date.now() / 1000),
  );
}

/** 直接写库建会话，返回可放进 Cookie 头的 `sid=...`（不经过登录接口，省一次密码哈希） */
export async function createSessionCookie(
  userId: number,
  overrides: { created_at?: number; last_seen_at?: number; expires_at?: number } = {},
): Promise<{ cookie: string; idHash: string }> {
  const token = toBase64Url(randomBytes(32));
  const idHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  await insertSession(env.APP_DB, {
    id_hash: idHash,
    user_id: userId,
    auth_methods: "password",
    created_at: overrides.created_at ?? now,
    last_seen_at: overrides.last_seen_at ?? now,
    expires_at: overrides.expires_at ?? now + 3600,
    ip: null,
    user_agent: "vitest",
  });
  return { cookie: `sid=${token}`, idHash };
}

export type ApiOptions = {
  method?: string;
  json?: unknown;
  cookie?: string;
  /** 默认对写操作自动带上 Origin 与 CSRF 头；传 false 可单独去掉 */
  origin?: string | false;
  csrf?: boolean;
  headers?: Record<string, string>;
  /** 覆盖绑定，例如去掉 APP_SECRET */
  bindings?: Partial<Bindings>;
};

function buildHeaders(method: string, options: ApiOptions): Headers {
  const headers = new Headers(options.headers);
  if (method !== "GET" && method !== "HEAD") {
    if (options.origin !== false) headers.set("Origin", options.origin ?? env.PUBLIC_ORIGIN);
    if (options.csrf !== false) headers.set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);
  }
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.json !== undefined) headers.set("Content-Type", "application/json");
  return headers;
}

/**
 * 默认放行的限流替身：绝大多数测试不关心限流，而 wrangler.jsonc 里的真实 binding 在同一个测试文件内
 * 共享计数（本地无 CF-Connecting-IP 时共用一个桶），登录次数一多会互相干扰。
 * 限流本身的测试通过 `bindings.RATE_LIMITER` 显式传入真实 binding 或自己的替身。
 */
export const ALLOW_ALL_RATE_LIMITER: RateLimit = { limit: async () => ({ success: true }) };

/** 直接调用 Hono app 的请求封装 */
export async function api(path: string, options: ApiOptions = {}): Promise<Response> {
  const method = options.method ?? (options.json === undefined ? "GET" : "POST");
  const init: RequestInit = { method, headers: buildHeaders(method, options) };
  if (options.json !== undefined) init.body = JSON.stringify(options.json);
  return await app.request(path, init, { ...env, RATE_LIMITER: ALLOW_ALL_RATE_LIMITER, LINK_RATE_LIMITER: ALLOW_ALL_RATE_LIMITER, ...options.bindings });
}

/** 从响应的 Set-Cookie 里取 sid 的完整 Set-Cookie 行 */
export function sidSetCookie(res: Response): string | undefined {
  return res.headers.getSetCookie().find((line) => line.startsWith("sid="));
}

/** 走登录接口，返回可放进 Cookie 头的 `sid=...` */
export async function login(username: string, password = TEST_PASSWORD): Promise<string> {
  const res = await api("/api/auth/login", { json: { username, password } });
  if (res.status !== 200) throw new Error(`登录失败 ${res.status}: ${await res.text()}`);
  const line = sidSetCookie(res);
  if (!line) throw new Error("登录响应没有 sid Cookie");
  return line.split(";")[0] ?? "";
}

/** 建一个管理员并返回其会话 Cookie */
export async function adminSession(username = "root"): Promise<{ id: number; cookie: string }> {
  const id = await createUser({ username, role: "admin" });
  return { id, cookie: (await createSessionCookie(id)).cookie };
}

export async function sessionCount(userId?: number): Promise<number> {
  const statement =
    userId === undefined
      ? env.APP_DB.prepare("SELECT COUNT(*) AS n FROM sessions")
      : env.APP_DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").bind(userId);
  return (await statement.first<{ n: number }>())?.n ?? 0;
}

export type AuditRow = {
  actor_user_id: number | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
};

export async function auditRows(action?: string): Promise<AuditRow[]> {
  const base = "SELECT actor_user_id, action, target_type, target_id, detail FROM audit_logs";
  const statement =
    action === undefined
      ? env.APP_DB.prepare(`${base} ORDER BY id`)
      : env.APP_DB.prepare(`${base} WHERE action = ? ORDER BY id`).bind(action);
  const { results } = await statement.all<AuditRow>();
  return results;
}
