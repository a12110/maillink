import { env } from "cloudflare:workers";
import type { AdminUser } from "@maillink/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  TEST_PASSWORD,
  adminSession,
  api,
  createSessionCookie,
  createUser,
  login,
  resetApp,
  sessionCount,
} from "./helpers";

type ErrorBody = { error: { code: string; message: string } };
type ListBody = { items: AdminUser[]; next_cursor: string | null };

const NEW_PASSWORD = "another-long-password";

describe("管理端用户 CRUD", () => {
  let admin: { id: number; cookie: string };

  beforeEach(async () => {
    await resetApp();
    admin = await adminSession();
  });

  it("创建用户：201，默认角色 user、状态 active，登录方式标记为空，新用户能登录", async () => {
    const res = await api("/api/admin/users", {
      json: { username: "Bob", password: NEW_PASSWORD, display_name: "  Bobby ", email: "Bob@Example.com" },
      cookie: admin.cookie,
    });
    expect(res.status).toBe(201);
    const user = (await res.json()) as AdminUser;
    expect(user).toMatchObject({
      username: "Bob",
      display_name: "Bobby",
      email: "bob@example.com",
      role: "user",
      status: "active",
      last_login_at: null,
      mailbox_grant_count: 0,
      login_methods: { password: true, totp: false, passkey_count: 0, oauth_providers: [] },
    });
    expect(JSON.stringify(user)).not.toContain("password_hash");
    expect(await login("bob", NEW_PASSWORD)).toMatch(/^sid=/);
  });

  it("创建：用户名大小写不敏感唯一 → 409 username_taken；邮箱重复 → 409 email_taken", async () => {
    await createUser({ username: "Carol", email: "carol@example.com" });
    const dupName = await api("/api/admin/users", { json: { username: "CAROL", password: NEW_PASSWORD }, cookie: admin.cookie });
    expect(dupName.status).toBe(409);
    expect(((await dupName.json()) as ErrorBody).error.code).toBe("username_taken");

    const dupEmail = await api("/api/admin/users", {
      json: { username: "carol2", password: NEW_PASSWORD, email: "CAROL@example.com" },
      cookie: admin.cookie,
    });
    expect(dupEmail.status).toBe(409);
    expect(((await dupEmail.json()) as ErrorBody).error.code).toBe("email_taken");
  });

  it("创建：用户名与密码规则校验 → 400", async () => {
    const cases = [
      { username: "ab", password: NEW_PASSWORD },
      { username: "bad name", password: NEW_PASSWORD },
      { username: "_leading", password: NEW_PASSWORD },
      { username: "x".repeat(33), password: NEW_PASSWORD },
      { username: "valid-name", password: "short" },
      { username: "valid-name", password: NEW_PASSWORD, email: "not-an-email" },
      { username: "valid-name", password: NEW_PASSWORD, role: "root" },
    ];
    for (const body of cases) {
      const res = await api("/api/admin/users", { json: body, cookie: admin.cookie });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe("validation_error");
    }
  });

  it("详情：不存在 404，id 非法 400", async () => {
    const id = await createUser({ username: "dave" });
    const ok = await api(`/api/admin/users/${id}`, { cookie: admin.cookie });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as AdminUser).username).toBe("dave");
    expect((await api("/api/admin/users/99999", { cookie: admin.cookie })).status).toBe(404);
    expect((await api("/api/admin/users/abc", { cookie: admin.cookie })).status).toBe(400);
  });

  it("修改：用户名、显示名、邮箱；空串清空；空请求体 400；冲突 409", async () => {
    const id = await createUser({ username: "erin", email: "erin@example.com" });
    await createUser({ username: "frank", email: "frank@example.com" });

    const res = await api(`/api/admin/users/${id}`, {
      method: "PATCH",
      json: { username: "Erin2", display_name: "Erin", email: "" },
      cookie: admin.cookie,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ username: "Erin2", display_name: "Erin", email: null });

    const empty = await api(`/api/admin/users/${id}`, { method: "PATCH", json: {}, cookie: admin.cookie });
    expect(empty.status).toBe(400);

    const nameClash = await api(`/api/admin/users/${id}`, { method: "PATCH", json: { username: "FRANK" }, cookie: admin.cookie });
    expect(nameClash.status).toBe(409);
    const emailClash = await api(`/api/admin/users/${id}`, {
      method: "PATCH",
      json: { email: "frank@example.com" },
      cookie: admin.cookie,
    });
    expect(emailClash.status).toBe(409);

    const missing = await api("/api/admin/users/99999", { method: "PATCH", json: { display_name: "x" }, cookie: admin.cookie });
    expect(missing.status).toBe(404);
  });

  it("删除：级联删除会话；不存在 404", async () => {
    const id = await createUser({ username: "gina" });
    await createSessionCookie(id);
    const res = await api(`/api/admin/users/${id}`, { method: "DELETE", cookie: admin.cookie });
    expect(res.status).toBe(200);
    expect(await sessionCount(id)).toBe(0);
    expect((await api(`/api/admin/users/${id}`, { cookie: admin.cookie })).status).toBe(404);
    expect((await api(`/api/admin/users/${id}`, { method: "DELETE", cookie: admin.cookie })).status).toBe(404);
  });
});

describe("管理端用户列表", () => {
  let admin: { id: number; cookie: string };

  beforeEach(async () => {
    await resetApp();
    admin = await adminSession("root");
  });

  async function list(query: string): Promise<ListBody> {
    const res = await api(`/api/admin/users${query}`, { cookie: admin.cookie });
    expect(res.status).toBe(200);
    return (await res.json()) as ListBody;
  }

  it("分页：{ items, next_cursor }，cursor 走完为 null", async () => {
    for (const name of ["u1", "u2", "u3", "u4"]) await createUser({ username: name });
    const first = await list("?limit=2");
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();
    const second = await list(`?limit=2&cursor=${first.next_cursor}`);
    expect(second.items).toHaveLength(2);
    const third = await list(`?limit=2&cursor=${second.next_cursor}`);
    expect(third.items.map((item) => item.username)).toEqual(["root"]);
    expect(third.next_cursor).toBeNull();

    const all = [...first.items, ...second.items, ...third.items].map((item) => item.username);
    expect(new Set(all).size).toBe(5);
  });

  it("limit 与 cursor 非法 → 400", async () => {
    for (const query of ["?limit=0", "?limit=101", "?limit=abc", "?cursor=abc", "?role=boss", "?status=gone"]) {
      expect((await api(`/api/admin/users${query}`, { cookie: admin.cookie })).status, query).toBe(400);
    }
  });

  it("关键词匹配用户名 / 邮箱 / 显示名；LIKE 通配符按字面处理", async () => {
    await createUser({ username: "alice", email: "alice@corp.test" });
    await createUser({ username: "bob", email: "bob@other.test" });
    await createUser({ username: "100%real" });
    await env.APP_DB.prepare("UPDATE users SET display_name = 'Zed Person' WHERE username = 'bob'").run();

    expect((await list("?q=ALI")).items.map((u) => u.username)).toEqual(["alice"]);
    expect((await list("?q=other.test")).items.map((u) => u.username)).toEqual(["bob"]);
    expect((await list("?q=zed")).items.map((u) => u.username)).toEqual(["bob"]);
    expect((await list("?q=100%25")).items.map((u) => u.username)).toEqual(["100%real"]);
    expect((await list("?q=%25")).items.map((u) => u.username)).toEqual(["100%real"]);
    expect((await list("?q=_")).items).toEqual([]);
  });

  it("按角色与状态筛选", async () => {
    await createUser({ username: "off", status: "disabled" });
    await createUser({ username: "boss", role: "admin" });
    expect((await list("?role=admin")).items.map((u) => u.username).sort()).toEqual(["boss", "root"]);
    expect((await list("?status=disabled")).items.map((u) => u.username)).toEqual(["off"]);
    expect((await list("?role=admin&status=disabled")).items).toEqual([]);
  });

  it("登录方式标记与授权邮箱数从对应表计算", async () => {
    const id = await createUser({ username: "rich" });
    const db = env.APP_DB;
    await db.prepare("UPDATE users SET totp_enabled_at = 5 WHERE id = ?").bind(id).run();
    await db
      .prepare("INSERT INTO user_passkeys (user_id, name, credential_id, public_key, created_at) VALUES (?, 'k1', 'c1', 'p', 1), (?, 'k2', 'c2', 'p', 1)")
      .bind(id, id)
      .run();
    await db
      .prepare(
        `INSERT INTO oauth_providers (slug, name, kind, client_id, client_secret_enc, scopes, claim_map, created_at, updated_at)
         VALUES ('github', 'GitHub', 'oauth2', 'cid', 'enc', 'user', '{}', 1, 1), ('gitlab', 'GitLab', 'oidc', 'cid', 'enc', 'openid', '{}', 1, 1)`,
      )
      .run();
    await db
      .prepare("INSERT INTO user_identities (user_id, provider_id, subject, created_at) VALUES (?, 1, 's1', 1), (?, 2, 's2', 1)")
      .bind(id, id)
      .run();
    await db
      .prepare(
        "INSERT INTO mailboxes (address, address_lc, created_at, updated_at) VALUES ('a@x.test', 'a@x.test', 1, 1), ('b@x.test', 'b@x.test', 1, 1), ('c@x.test', 'c@x.test', 1, 1)",
      )
      .run();
    await db
      .prepare("INSERT INTO user_mailbox_grants (user_id, mailbox_id, created_at) VALUES (?, 1, 1), (?, 2, 1), (?, 3, 1)")
      .bind(id, id, id)
      .run();

    const rich = (await list("?q=rich")).items[0];
    expect(rich?.login_methods).toEqual({
      password: true,
      totp: true,
      passkey_count: 2,
      oauth_providers: expect.arrayContaining(["github", "gitlab"]),
    });
    expect(rich?.login_methods.oauth_providers).toHaveLength(2);
    expect(rich?.mailbox_grant_count).toBe(3);

    const detail = (await (await api(`/api/admin/users/${id}`, { cookie: admin.cookie })).json()) as AdminUser;
    expect(detail.mailbox_grant_count).toBe(3);
    expect(detail.login_methods.passkey_count).toBe(2);
  });
});

describe("最后一个启用的管理员保护", () => {
  let admin: { id: number; cookie: string };

  beforeEach(async () => {
    await resetApp();
    admin = await adminSession("root");
  });

  async function expectProtected(res: Response): Promise<void> {
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe("last_admin_protected");
  }

  it("不能降级", async () => {
    await expectProtected(
      await api(`/api/admin/users/${admin.id}`, { method: "PATCH", json: { role: "user" }, cookie: admin.cookie }),
    );
  });

  it("不能禁用", async () => {
    await expectProtected(
      await api(`/api/admin/users/${admin.id}`, { method: "PATCH", json: { status: "disabled" }, cookie: admin.cookie }),
    );
  });

  it("不能删除", async () => {
    await expectProtected(await api(`/api/admin/users/${admin.id}`, { method: "DELETE", cookie: admin.cookie }));
  });

  it("被拒绝后数据与会话都没有变化", async () => {
    await api(`/api/admin/users/${admin.id}`, { method: "PATCH", json: { role: "user", status: "disabled" }, cookie: admin.cookie });
    const row = await env.APP_DB.prepare("SELECT role, status FROM users WHERE id = ?").bind(admin.id).first();
    expect(row).toEqual({ role: "admin", status: "active" });
    expect((await api("/api/auth/session", { cookie: admin.cookie })).status).toBe(200);
  });

  it("不改角色与状态的修改不受影响", async () => {
    const res = await api(`/api/admin/users/${admin.id}`, { method: "PATCH", json: { display_name: "Boss" }, cookie: admin.cookie });
    expect(res.status).toBe(200);
  });

  it("把另一个管理员降级之后，自己就成了最后一个：再次被保护", async () => {
    const other = await createUser({ username: "second", role: "admin" });
    const demote = await api(`/api/admin/users/${other}`, { method: "PATCH", json: { role: "user" }, cookie: admin.cookie });
    expect(demote.status).toBe(200);
    await expectProtected(
      await api(`/api/admin/users/${admin.id}`, { method: "PATCH", json: { role: "user" }, cookie: admin.cookie }),
    );
  });

  it("已禁用的管理员不算数：唯一启用的管理员仍受保护", async () => {
    await createUser({ username: "dormant", role: "admin", status: "disabled" });
    await expectProtected(
      await api(`/api/admin/users/${admin.id}`, { method: "PATCH", json: { role: "user" }, cookie: admin.cookie }),
    );
    await expectProtected(await api(`/api/admin/users/${admin.id}`, { method: "DELETE", cookie: admin.cookie }));
  });

  it("还有其他启用的管理员时：可以降级、禁用、删除", async () => {
    const second = await createUser({ username: "second", role: "admin" });
    const third = await createUser({ username: "third", role: "admin" });
    const fourth = await createUser({ username: "fourth", role: "admin" });
    expect((await api(`/api/admin/users/${second}`, { method: "PATCH", json: { role: "user" }, cookie: admin.cookie })).status).toBe(200);
    expect((await api(`/api/admin/users/${third}`, { method: "PATCH", json: { status: "disabled" }, cookie: admin.cookie })).status).toBe(200);
    expect((await api(`/api/admin/users/${fourth}`, { method: "DELETE", cookie: admin.cookie })).status).toBe(200);
  });

  it("两个管理员同时互相降级：保护在 SQL 里，不会把管理员改光", async () => {
    const other = await adminSession("second");
    const results = await Promise.all([
      api(`/api/admin/users/${other.id}`, { method: "PATCH", json: { role: "user" }, cookie: admin.cookie }),
      api(`/api/admin/users/${admin.id}`, { method: "PATCH", json: { role: "user" }, cookie: other.cookie }),
    ]);
    const statuses = results.map((res) => res.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    const active = await env.APP_DB
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'")
      .first<{ n: number }>();
    expect(active?.n).toBe(1);
  });
});

describe("会话失效规则", () => {
  let admin: { id: number; cookie: string };

  beforeEach(async () => {
    await resetApp();
    admin = await adminSession("root");
  });

  it("角色变化：该用户全部会话失效", async () => {
    const id = await createUser({ username: "hank" });
    const one = await createSessionCookie(id);
    await createSessionCookie(id);
    await api(`/api/admin/users/${id}`, { method: "PATCH", json: { role: "admin" }, cookie: admin.cookie });
    expect(await sessionCount(id)).toBe(0);
    expect((await api("/api/auth/session", { cookie: one.cookie })).status).toBe(401);
  });

  it("状态变化（禁用）：全部会话失效，且无法再登录", async () => {
    const id = await createUser({ username: "ivy" });
    await createSessionCookie(id);
    await api(`/api/admin/users/${id}`, { method: "PATCH", json: { status: "disabled" }, cookie: admin.cookie });
    expect(await sessionCount(id)).toBe(0);
    expect((await api("/api/auth/login", { json: { username: "ivy", password: TEST_PASSWORD } })).status).toBe(401);
  });

  it("只改显示名等无关字段：会话保留；角色传入相同值也算没变化", async () => {
    const id = await createUser({ username: "jack" });
    await createSessionCookie(id);
    await api(`/api/admin/users/${id}`, { method: "PATCH", json: { display_name: "Jack" }, cookie: admin.cookie });
    await api(`/api/admin/users/${id}`, { method: "PATCH", json: { role: "user", status: "active" }, cookie: admin.cookie });
    expect(await sessionCount(id)).toBe(1);
  });

  it("重置密码：新密码可登录、旧密码不可，全部会话失效；密码规则校验", async () => {
    const id = await createUser({ username: "kate" });
    await createSessionCookie(id);
    const weak = await api(`/api/admin/users/${id}/password`, { json: { password: "short" }, cookie: admin.cookie });
    expect(weak.status).toBe(400);
    expect(await sessionCount(id)).toBe(1);

    const res = await api(`/api/admin/users/${id}/password`, { json: { password: NEW_PASSWORD }, cookie: admin.cookie });
    expect(res.status).toBe(200);
    expect(await sessionCount(id)).toBe(0);
    expect((await api("/api/auth/login", { json: { username: "kate", password: TEST_PASSWORD } })).status).toBe(401);
    expect((await api("/api/auth/login", { json: { username: "kate", password: NEW_PASSWORD } })).status).toBe(200);
  });

  it("强制下线：返回删除条数，只影响该用户", async () => {
    const id = await createUser({ username: "liam" });
    await createSessionCookie(id);
    await createSessionCookie(id);
    const res = await api(`/api/admin/users/${id}/sessions`, { method: "DELETE", cookie: admin.cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", revoked: 2 });
    expect(await sessionCount(id)).toBe(0);
    expect((await api("/api/auth/session", { cookie: admin.cookie })).status).toBe(200);
  });

  it("目标用户不存在：重置密码与强制下线都是 404", async () => {
    expect((await api("/api/admin/users/99999/password", { json: { password: NEW_PASSWORD }, cookie: admin.cookie })).status).toBe(404);
    expect((await api("/api/admin/users/99999/sessions", { method: "DELETE", cookie: admin.cookie })).status).toBe(404);
  });

  it("管理员降级自己（还有别的管理员时）：允许，且自己的会话随即失效", async () => {
    await createUser({ username: "backup", role: "admin" });
    const res = await api(`/api/admin/users/${admin.id}`, { method: "PATCH", json: { role: "user" }, cookie: admin.cookie });
    expect(res.status).toBe(200);
    expect((await api("/api/auth/session", { cookie: admin.cookie })).status).toBe(401);
  });
});
