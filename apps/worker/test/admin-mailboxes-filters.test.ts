import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { adminMailboxListResponseSchema, mailboxTagListResponseSchema, type AdminMailboxListResponse } from "@maillink/shared";
import { MAILBOX_TAG_LIST_MAX } from "../src/constants";
import { adminSession, api, resetApp } from "./helpers";
import { createLink, createRuleGroup, importMailboxes } from "./link-helpers";

// 收件地址列表的"有链接 / 无链接"筛选、启用数与停用数，以及标签计数接口。

let cookie = "";
beforeEach(async () => {
  await resetApp();
  cookie = (await adminSession()).cookie;
});

const list = async (query = ""): Promise<AdminMailboxListResponse> => {
  const res = await api(`/api/admin/mailboxes${query}`, { cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return adminMailboxListResponseSchema.parse(await res.json());
};

describe("GET /api/admin/mailboxes 筛选与计数", () => {
  it("has_link 筛选；active_count / disabled_count 不受 status 筛选影响、受其他筛选影响", async () => {
    const ids = await importMailboxes(cookie, ["a@example.com", "b@example.com", "c@example.com", "d@example.com"]);
    const [a = 0, b = 0, c = 0] = ["a@example.com", "b@example.com", "c@example.com"].map((address) => ids.get(address) ?? 0);
    const group = await createRuleGroup(cookie);
    await createLink(cookie, { mailbox_ids: [a, b], rule_group_id: group });
    await env.APP_DB.prepare("UPDATE mailboxes SET status = 'disabled' WHERE id IN (?, ?)").bind(b, c).run();

    const all = await list();
    expect([all.total, all.active_count, all.disabled_count]).toEqual([4, 2, 2]);

    const linked = await list("?has_link=true");
    expect(linked.items.map((item) => item.address).toSorted()).toEqual(["a@example.com", "b@example.com"]);
    expect([linked.total, linked.active_count, linked.disabled_count]).toEqual([2, 1, 1]);

    const unlinked = await list("?has_link=false");
    expect(unlinked.items.map((item) => item.address).toSorted()).toEqual(["c@example.com", "d@example.com"]);

    const activeUnlinked = await list("?has_link=false&status=active");
    expect(activeUnlinked.items.map((item) => item.address)).toEqual(["d@example.com"]);
    expect([activeUnlinked.total, activeUnlinked.active_count, activeUnlinked.disabled_count]).toEqual([1, 1, 1]);

    expect((await api("/api/admin/mailboxes?has_link=1", { cookie })).status).toBe(400);
  });

  it("没有任何地址时计数为 0", async () => {
    const empty = await list();
    expect([empty.total, empty.active_count, empty.disabled_count]).toEqual([0, 0, 0]);
  });
});

describe("GET /api/admin/mailboxes/tags", () => {
  it("按使用次数降序、同次数按标签名；只给管理员", async () => {
    const res0 = await api("/api/admin/mailboxes/import", {
      cookie,
      json: { content: "a@example.com,,vip gold\nb@example.com,,gold\nc@example.com,,gold beta" },
    });
    expect(res0.status).toBe(201);
    const res = await api("/api/admin/mailboxes/tags", { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mailboxTagListResponseSchema.parse(await res.json())).toEqual({
      items: [
        { tag: "gold", count: 3 },
        { tag: "beta", count: 1 },
        { tag: "vip", count: 1 },
      ],
      truncated: false,
    });
    expect((await api("/api/admin/mailboxes/tags")).status).toBe(401);
  });

  it("超过上限时截断并标出 truncated", async () => {
    const ids = await importMailboxes(cookie, ["a@example.com"]);
    const id = ids.get("a@example.com") ?? 0;
    const tags = Array.from({ length: MAILBOX_TAG_LIST_MAX + 1 }, (_, index) => `t${String(index).padStart(4, "0")}`);
    await env.APP_DB.prepare("INSERT INTO mailbox_tags (mailbox_id, tag) SELECT ?1, value FROM json_each(?2)").bind(id, JSON.stringify(tags)).run();
    const body = mailboxTagListResponseSchema.parse(await (await api("/api/admin/mailboxes/tags", { cookie })).json());
    expect(body.items).toHaveLength(MAILBOX_TAG_LIST_MAX);
    expect(body.truncated).toBe(true);
  });
});
