import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { AdminMailbox, AdminMailboxListResponse, MailboxBatchResponse, MailboxImportResponse } from "@maillink/shared";
import { nowSec } from "../src/clock";
import { normalizeMailboxAddress, parseMailboxImport, splitImportLine } from "../src/routes/mailbox-import-parse";
import { putMail } from "./access-helpers";
import { adminSession, api, auditRows, createSessionCookie, createUser, resetApp } from "./helpers";

// 收件地址 API（04 管理端 / 收件地址）：导入预览三类、规范化与大小写去重、列表（总数、最近来信）、修改、批量、删除。

let cookie = "";
beforeEach(async () => {
  await resetApp();
  cookie = (await adminSession()).cookie;
});

const importMailboxes = async (content: string, extra: Record<string, unknown> = {}) => {
  const res = await api("/api/admin/mailboxes/import", { cookie, json: { content, ...extra } });
  return { status: res.status, body: (await res.json()) as MailboxImportResponse };
};

const listMailboxes = async (query = ""): Promise<AdminMailboxListResponse> => {
  const res = await api(`/api/admin/mailboxes${query}`, { cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as AdminMailboxListResponse;
};

describe("导入解析（纯函数）", () => {
  it("地址规范化：去空白、域名小写；本地部分保留大小写", () => {
    expect(normalizeMailboxAddress("  Foo.Bar@Example.COM ")).toEqual({ address: "Foo.Bar@example.com", address_lc: "foo.bar@example.com" });
    expect(normalizeMailboxAddress("a b@example.com")).toEqual({ address: "ab@example.com", address_lc: "ab@example.com" });
  });

  it.each(["no-at-sign", "@example.com", "a@", "a@b", "a@-x.com", "a..b@example.com", "a@exa_mple.com", "a@example.123"])(
    "无效格式 %s",
    (input) => expect(normalizeMailboxAddress(input)).toEqual({ error: "invalid_format" }),
  );

  it("超长", () => {
    expect(normalizeMailboxAddress(`${"a".repeat(65)}@example.com`)).toEqual({ error: "too_long" });
    expect(normalizeMailboxAddress(`a@${"b".repeat(250)}.com`)).toEqual({ error: "too_long" });
  });

  it("CSV 单元格：逗号或制表符分隔，双引号转义", () => {
    expect(splitImportLine('a@x.com,vip;gold,"note, with comma"')).toEqual(["a@x.com", "vip;gold", "note, with comma"]);
    expect(splitImportLine('a@x.com\t"say ""hi"""')).toEqual(["a@x.com", 'say "hi"']);
  });

  it("列序是 地址, 平台, 备注（06 §8）：表头跳过、空行跳过、平台列映射成标签并与统一标签合并", () => {
    const lines = parseMailboxImport("address,platform,note\n\nA@X.com,vip gold,备注\nb@x.com,bad,,tag", ["batch1"]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ line: 3, address: "A@x.com", address_lc: "a@x.com", note: "备注", tags: ["vip", "gold", "batch1"], error: null });
    expect(lines[1]).toMatchObject({ line: 4, note: null, tags: ["bad", "batch1"], error: null });
  });
});

describe("POST /api/admin/mailboxes/import", () => {
  it("dry_run：新增 / 重复 / 无效三类逐条给出原因，不写库", async () => {
    await importMailboxes("exist@example.com");
    const { status, body } = await importMailboxes(
      ["new@example.com", "EXIST@Example.com", "New@EXAMPLE.com", "not-an-address", `x@example.com,,${"n".repeat(501)}`].join("\n"),
      { dry_run: true },
    );
    expect(status).toBe(200);
    expect(body.dry_run).toBe(true);
    expect(body.summary).toEqual({ new: 1, duplicate: 2, invalid: 2 });
    expect(body.items.map((item) => [item.status, item.reason])).toEqual([
      ["new", null],
      ["duplicate", "already_exists"],
      ["duplicate", "duplicate_in_input"],
      ["invalid", "invalid_format"],
      ["invalid", "note_too_long"],
    ]);
    expect(body.items[1]?.id).toEqual(expect.any(Number));
    const count = await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM mailboxes").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("正式导入：写入地址、备注、标签；大小写不同视为重复；写审计", async () => {
    const { status, body } = await importMailboxes("Alice@Example.com,vip,第一批\nalice@example.com\nbob@example.com", { tags: ["t1"] });
    expect(status).toBe(201);
    expect(body.summary).toEqual({ new: 2, duplicate: 1, invalid: 0 });
    expect(body.items[0]?.id).toEqual(expect.any(Number));
    const page = await listMailboxes();
    const alice = page.items.find((item) => item.address === "Alice@example.com");
    expect(alice).toMatchObject({ note: "第一批", tags: ["t1", "vip"], status: "active" });
    expect(page.items.find((item) => item.address === "bob@example.com")?.tags).toEqual(["t1"]);
    const audit = await auditRows("mailbox.import");
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.detail ?? "{}")).toMatchObject({ new: 2, duplicate: 1, invalid: 0 });
  });

  it("再次导入已有地址不会给它补打标签", async () => {
    await importMailboxes("a@example.com");
    await importMailboxes("a@example.com,late");
    expect((await listMailboxes()).items[0]?.tags).toEqual([]);
  });

  it("并发同秒导入同一地址：只有真正插入的一方写标签，另一方记为已存在", async () => {
    const [first, second] = await Promise.all([
      importMailboxes("race@example.com,from-a"),
      importMailboxes("race@example.com,from-b"),
    ]);
    const statuses = [first.body.items[0]?.status, second.body.items[0]?.status].sort();
    expect(statuses).toEqual(["duplicate", "new"]);
    const winner = first.body.items[0]?.status === "new" ? "from-a" : "from-b";
    const page = await listMailboxes();
    expect(page.total).toBe(1);
    expect(page.items[0]?.tags).toEqual([winner]);
    const loser = first.body.items[0]?.status === "new" ? second.body : first.body;
    expect(loser.items[0]).toMatchObject({ reason: "already_exists", id: page.items[0]?.id });
  });

  it("权限：普通用户 403", async () => {
    const userCookie = (await createSessionCookie(await createUser({ username: "plain" }))).cookie;
    const res = await api("/api/admin/mailboxes/import", { cookie: userCookie, json: { content: "a@example.com" } });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/mailboxes", () => {
  it("带总数、链接数、授权数与最近来信时间；关键词 / 标签 / 状态筛选与游标分页", async () => {
    await importMailboxes("one@example.com,red\ntwo@example.com,blue\nthree@example.com,red");
    await putMail({ address: "one@example.com", ageSec: 120 });
    const latest = await putMail({ address: "one@example.com", ageSec: 10 });
    expect(latest).toBeGreaterThan(0);

    expect((await api("/api/admin/mailboxes", { cookie })).headers.get("Cache-Control")).toBe("no-store");
    const all = await listMailboxes("?limit=2");
    expect(all.total).toBe(3);
    expect(all.items).toHaveLength(2);
    expect(all.next_cursor).not.toBeNull();
    const rest = await listMailboxes(`?limit=2&cursor=${all.next_cursor}`);
    expect(rest.items).toHaveLength(1);
    expect(rest.next_cursor).toBeNull();

    const one = [...all.items, ...rest.items].find((item) => item.address === "one@example.com") as AdminMailbox;
    expect(one.last_received_at).toBeGreaterThanOrEqual(nowSec() - 15);
    expect(one).toMatchObject({ link_count: 0, grant_count: 0 });
    expect([...all.items, ...rest.items].find((item) => item.address === "two@example.com")?.last_received_at).toBeNull();

    expect((await listMailboxes("?tag=red")).total).toBe(2);
    expect((await listMailboxes("?q=TWO")).items.map((item) => item.address)).toEqual(["two@example.com"]);
    expect((await listMailboxes("?status=disabled")).total).toBe(0);
  });
});

describe("修改、批量与删除", () => {
  it("PATCH：改名称、备注、状态，标签整体替换；不存在 404", async () => {
    const { body } = await importMailboxes("a@example.com,old");
    const id = body.items[0]?.id as number;
    const res = await api(`/api/admin/mailboxes/${id}`, {
      cookie,
      method: "PATCH",
      json: { label: "主号", note: null, status: "disabled", tags: ["x", "y"] },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, label: "主号", note: null, status: "disabled", tags: ["x", "y"] });
    expect((await api("/api/admin/mailboxes/99999", { cookie, method: "PATCH", json: { label: "x" } })).status).toBe(404);
    expect((await api(`/api/admin/mailboxes/${id}`, { cookie, method: "PATCH", json: {} })).status).toBe(400);
  });

  it("batch：打标签 / 去标签 / 停用 / 删除，逐条结果含不存在的 id", async () => {
    const { body } = await importMailboxes("a@example.com\nb@example.com");
    const ids = body.items.map((item) => item.id as number);
    const run = async (json: unknown) => {
      const res = await api("/api/admin/mailboxes/batch", { cookie, json });
      expect(res.status, await res.clone().text()).toBe(200);
      return ((await res.json()) as MailboxBatchResponse).results;
    };
    expect(await run({ ids: [...ids, 99999], action: "add_tags", tags: ["k"] })).toEqual([
      { id: ids[0], ok: true, error: null },
      { id: ids[1], ok: true, error: null },
      { id: 99999, ok: false, error: "not_found" },
    ]);
    expect((await listMailboxes("?tag=k")).total).toBe(2);
    await run({ ids: [ids[0]], action: "remove_tags", tags: ["k"] });
    expect((await listMailboxes("?tag=k")).total).toBe(1);
    await run({ ids, action: "disable" });
    expect((await listMailboxes("?status=disabled")).total).toBe(2);
    expect((await run({ ids: [ids[0], 99999], action: "delete" })).map((r) => r.ok)).toEqual([true, false]);
    expect((await listMailboxes()).total).toBe(1);
    const batchAudit = await auditRows("mailbox.batch");
    expect(batchAudit.length).toBe(4);
    expect(JSON.parse(batchAudit[3]?.detail ?? "{}")).toMatchObject({
      action: "delete",
      deleted: [{ id: ids[0], address: "a@example.com", link_count: 0, grant_count: 0 }],
    });
  });

  it("batch：标签超上限的行单独失败", async () => {
    const tags = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const { body } = await importMailboxes("a@example.com", { tags });
    const id = body.items[0]?.id as number;
    const res = await api("/api/admin/mailboxes/batch", { cookie, json: { ids: [id], action: "add_tags", tags: ["one-more"] } });
    expect(((await res.json()) as MailboxBatchResponse).results).toEqual([{ id, ok: false, error: "too_many_tags" }]);
    expect((await api("/api/admin/mailboxes/batch", { cookie, json: { ids: [id], action: "add_tags" } })).status).toBe(400);
  });

  it("DELETE：删除并写审计；再删 404", async () => {
    const { body } = await importMailboxes("a@example.com");
    const id = body.items[0]?.id as number;
    expect((await api(`/api/admin/mailboxes/${id}`, { cookie, method: "DELETE" })).status).toBe(200);
    expect((await api(`/api/admin/mailboxes/${id}`, { cookie, method: "DELETE" })).status).toBe(404);
    expect(JSON.parse((await auditRows("mailbox.delete"))[0]?.detail ?? "{}")).toMatchObject({ address: "a@example.com" });
  });
});
