import { beforeEach, describe, expect, it } from "vitest";
import { myMailListResponseSchema, type MyMailListResponse } from "@maillink/shared";
import { baseConfig, putMail } from "./access-helpers";
import { api, createSessionCookie, createUser, resetApp } from "./helpers";
import { insertGrant, insertMailbox, insertRuleGroup } from "./grants-helpers";

// /api/me/mails 的列表项带所属授权的 mailbox_id 与 view（"全部"里前端据此决定有无详情）。

let cookie = "";
let alice = 0;

beforeEach(async () => {
  await resetApp();
  alice = await createUser({ username: "alice" });
  cookie = (await createSessionCookie(alice)).cookie;
});

const MAX_PARTIAL_RETRIES = 30;

async function settled(query: string): Promise<MyMailListResponse> {
  for (let attempt = 0; attempt < MAX_PARTIAL_RETRIES; attempt += 1) {
    const res = await api(`/api/me/mails${query}`, { cookie });
    expect(res.status).toBe(200);
    const body = myMailListResponseSchema.parse(await res.json());
    if (!body.partial) return body;
  }
  throw new Error(`重试 ${MAX_PARTIAL_RETRIES} 次仍是 partial：${query}`);
}

describe("列表项的 mailbox_id 与 view", () => {
  it("全部：多个规则组、地址大小写不同，各项对回各自授权；单个邮箱同样带上", async () => {
    const boxA = await insertMailbox("a@example.com");
    const boxB = await insertMailbox("Mixed.Case@Example.com");
    const metaOnly = await insertRuleGroup("meta", baseConfig({ present: { view: "meta_only", recipient: "hidden" } }));
    await insertGrant({ userId: alice, mailboxId: boxA });
    await insertGrant({ userId: alice, mailboxId: boxB, ruleGroupId: metaOnly });

    const a1 = await putMail({ address: "a@example.com", subject: "a1" });
    const b1 = await putMail({ address: "Mixed.Case@example.com", subject: "b1" });
    const a2 = await putMail({ address: "a@example.com", subject: "a2" });

    const all = await settled("");
    expect(all.items.map((item) => [item.id, item.mailbox_id, item.view])).toEqual([
      [a2, boxA, "full"],
      [b1, boxB, "meta_only"],
      [a1, boxA, "full"],
    ]);
    // hidden 的收件人设置照常生效：标签只给 id，不给地址
    expect(all.items.find((item) => item.id === b1)?.recipient).toBeUndefined();

    const onlyB = await settled(`?mailbox_id=${boxB}`);
    expect(onlyB.items.map((item) => [item.id, item.mailbox_id, item.view])).toEqual([[b1, boxB, "meta_only"]]);
  });

  it("全部只有一个作用域（同组多地址合并）时也逐封对回地址", async () => {
    const boxA = await insertMailbox("a@example.com");
    const boxB = await insertMailbox("b@example.com");
    await insertGrant({ userId: alice, mailboxId: boxA });
    await insertGrant({ userId: alice, mailboxId: boxB });
    const a1 = await putMail({ address: "a@example.com", subject: "a1" });
    const b1 = await putMail({ address: "b@example.com", subject: "b1" });

    const all = await settled("");
    expect(all.items.map((item) => [item.id, item.mailbox_id])).toEqual([
      [b1, boxB],
      [a1, boxA],
    ]);
  });
});
