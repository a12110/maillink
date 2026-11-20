import { beforeEach, describe, expect, it } from "vitest";
import type { VisibleMailListResponse } from "@maillink/shared";
import { nowSec } from "../src/clock";
import { LIST_PAGE_SIZE, MAX_PARSE_PER_REQUEST, ME_ALL_MAX_SCOPES, SCAN_CAP_PER_REQUEST } from "../src/constants";
import { baseConfig, mailIndexIds, putMail } from "./access-helpers";
import { api, createSessionCookie, createUser, resetApp } from "./helpers";
import { denySubjectConfig, grantRow, insertGrant, insertMailbox, insertRuleGroup } from "./grants-helpers";

// "全部"（不指定 mailbox）：多个授权按规则组分组、各取一页后按 id 降序归并。

type ErrorBody = { error: { code: string } };

let cookie = "";
let alice = 0;

beforeEach(async () => {
  await resetApp();
  alice = await createUser({ username: "alice" });
  cookie = (await createSessionCookie(alice)).cookie;
});

const fetchMails = async (query: string) => {
  const res = await api(`/api/me/mails${query}`, { cookie });
  return { status: res.status, body: (await res.json()) as VisibleMailListResponse & ErrorBody };
};

const MAX_PARTIAL_RETRIES = 60;

/** 与前端一致：partial 时用同样的参数重取，直到不是 partial（每次请求只解析有限封数） */
async function settled(query: string): Promise<VisibleMailListResponse> {
  let first: VisibleMailListResponse | undefined;
  for (let attempt = 0; attempt < MAX_PARTIAL_RETRIES; attempt += 1) {
    const { status, body } = await fetchMails(query);
    expect(status).toBe(200);
    first ??= body;
    if (!body.partial) return body;
  }
  throw new Error(`重试 ${MAX_PARTIAL_RETRIES} 次仍是 partial：${query}`);
}

/** 沿 next_cursor 一路翻到底，返回每页的 id */
async function walk(): Promise<number[][]> {
  const pages: number[][] = [];
  let cursor: string | null = null;
  for (let round = 0; round < 50; round += 1) {
    const body: VisibleMailListResponse = await settled(cursor === null ? "" : `?cursor=${cursor}`);
    pages.push(body.items.map((item) => item.id));
    if (body.next_cursor === null) return pages;
    cursor = body.next_cursor;
  }
  throw new Error("翻页超过 50 次仍未结束");
}

const SPAM = "spam";

describe("多规则组、含 partial 的分页不漏不重", () => {
  it("A 完整访问 + B、C 同一个黑名单组：逐页走完恰好是各授权单独视图的并集，id 严格降序", async () => {
    const [boxA, boxB, boxC] = [await insertMailbox("a@example.com"), await insertMailbox("b@example.com"), await insertMailbox("c@example.com")];
    const deny = await insertRuleGroup("deny-spam", denySubjectConfig(SPAM));
    await insertGrant({ userId: alice, mailboxId: boxA });
    await insertGrant({ userId: alice, mailboxId: boxB, ruleGroupId: deny });
    await insertGrant({ userId: alice, mailboxId: boxC, ruleGroupId: deny });

    const expected: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      expected.push(await putMail({ address: "a@example.com", subject: `a${i}` }));
      const b = await putMail({ address: "b@example.com", subject: i % 5 === 0 ? `${SPAM} b${i}` : `b${i}` });
      if (i % 5 !== 0) expected.push(b);
      if (i % 2 === 0) expected.push(await putMail({ address: "c@example.com", subject: `c${i}` }));
      await putMail({ address: "other@example.com", subject: "not granted" });
    }

    const cold = await fetchMails("");
    expect(cold.body.partial).toBe(true);
    expect(cold.body.next_after_id).toBeNull();

    const pages = await walk();
    const flat = pages.flat();
    expect(flat).toEqual(expected.toSorted((a, b) => b - a));
    expect(new Set(flat).size).toBe(flat.length);
    for (const full of pages.slice(0, -1)) expect(full).toHaveLength(LIST_PAGE_SIZE);
    expect(pages.length).toBeGreaterThan(2);
  });

  it("某个作用域一页扫满 SCAN_CAP 仍没凑够可见邮件（被屏蔽的邮件堆在前面）：游标停在它的进度上，更旧的合法邮件不会丢", async () => {
    const [boxA, boxB] = [await insertMailbox("a@example.com"), await insertMailbox("b@example.com")];
    const deny = await insertRuleGroup("deny-spam", denySubjectConfig(SPAM));
    await insertGrant({ userId: alice, mailboxId: boxA });
    await insertGrant({ userId: alice, mailboxId: boxB, ruleGroupId: deny });
    const expected: number[] = [];
    // id 从小到大：B 的 5 封合法邮件 → B 的一长串被屏蔽邮件（超过一次扫描上限）→ A 的 30 封
    for (let i = 0; i < 5; i += 1) expected.push(await putMail({ address: "b@example.com", subject: `b-old${i}` }));
    for (let i = 0; i < SCAN_CAP_PER_REQUEST + 10; i += 1) await putMail({ address: "b@example.com", subject: `${SPAM} ${i}` });
    for (let i = 0; i < 30; i += 1) expected.push(await putMail({ address: "a@example.com", subject: `a${i}` }));

    const flat = (await walk()).flat();
    expect(flat).toEqual(expected.toSorted((a, b) => b - a));
  });

  it("增量轮询：首页给出起点，之后新邮件跨组到来，逐轮取尽不漏不重；屏蔽的不出现", async () => {
    const [boxA, boxB] = [await insertMailbox("a@example.com"), await insertMailbox("b@example.com")];
    const deny = await insertRuleGroup("deny-spam", denySubjectConfig(SPAM));
    await insertGrant({ userId: alice, mailboxId: boxA });
    await insertGrant({ userId: alice, mailboxId: boxB, ruleGroupId: deny });
    await putMail({ address: "a@example.com", subject: "old a" });
    await putMail({ address: "b@example.com", subject: "old b" });

    const first = await settled("");
    expect(first.items).toHaveLength(2);
    const start = first.next_after_id;
    expect(start).not.toBeNull();

    const fresh = [
      await putMail({ address: "a@example.com", subject: "new a1" }),
      await putMail({ address: "b@example.com", subject: `${SPAM} hidden` }),
      await putMail({ address: "b@example.com", subject: "new b1" }),
      await putMail({ address: "a@example.com", subject: "new a2" }),
      await putMail({ address: "other@example.com", subject: "not granted" }),
    ];
    const expected = [fresh[0], fresh[2], fresh[3]];

    const seen: number[] = [];
    let after = start ?? 0;
    for (let round = 0; round < 20 && after < Math.max(...fresh); round += 1) {
      const body = await settled(`?after_id=${after}`);
      seen.push(...body.items.map((item) => item.id));
      expect(body.next_after_id).not.toBeNull();
      expect(body.next_after_id ?? 0).toBeGreaterThanOrEqual(after);
      after = body.next_after_id ?? after;
    }
    expect(seen.toSorted((a, b) => a - b)).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);
    // 取尽之后再轮询：没有新东西，after_id 不回退
    const idle = await settled(`?after_id=${after}`);
    expect(idle.items).toEqual([]);
    expect(idle.next_after_id).toBeGreaterThanOrEqual(after);
  });

  it("设了 max_mails 的授权各占一个作用域：只留它最新的 N 封，且跨页不丢", async () => {
    const [boxA, boxC] = [await insertMailbox("a@example.com"), await insertMailbox("c@example.com")];
    const capped = await insertRuleGroup("capped", baseConfig({ limits: { max_mails: 3 } }));
    await insertGrant({ userId: alice, mailboxId: boxA });
    await insertGrant({ userId: alice, mailboxId: boxC, ruleGroupId: capped });
    const aIds: number[] = [];
    const cIds: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      aIds.push(await putMail({ address: "a@example.com", subject: `a${i}` }));
      cIds.push(await putMail({ address: "c@example.com", subject: `c${i}` }));
    }
    const expected = [...aIds, ...cIds.slice(-3)].toSorted((a, b) => b - a);

    const pages = await walk();
    expect(pages.flat()).toEqual(expected);
    // C 最新的 3 封交错在 A 的最新邮件之间，第 1 页就含有一部分，其余在第 2 页
    expect(pages).toHaveLength(2);
    const single = await settled(`?mailbox_id=${boxC}`);
    expect(single.items.map((item) => item.id)).toEqual(cIds.slice(-3).toReversed());
  });

  it("规则组相同但时间下界不同的授权不共用锚点（subject_created 各按各的创建时间）", async () => {
    const [boxA, boxB] = [await insertMailbox("a@example.com"), await insertMailbox("b@example.com")];
    const created = await insertRuleGroup("created", baseConfig({ time: { since: { type: "subject_created" } } }));
    const oldA = await putMail({ address: "a@example.com", subject: "before A grant", ageSec: 3600 });
    const midB = await putMail({ address: "b@example.com", subject: "after B grant, before A grant", ageSec: 3600 });
    await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: created, createdAt: nowSec() - 60 });
    await insertGrant({ userId: alice, mailboxId: boxB, ruleGroupId: created, createdAt: nowSec() - 7200 });
    const newA = await putMail({ address: "a@example.com", subject: "new A", ageSec: 10 });

    const body = await settled("");
    expect(body.items.map((item) => item.id)).toEqual([newA, midB]);
    expect(body.items.map((item) => item.id)).not.toContain(oldA);
  });
});

describe("工作量上界", () => {
  it('"全部"跨作用域一次请求的现场解析量与单个作用域相同（MAX_PARSE_PER_REQUEST），其余 partial 等重取', async () => {
    const [boxA, boxB] = [await insertMailbox("a@example.com"), await insertMailbox("b@example.com")];
    const deny = await insertRuleGroup("deny-spam", denySubjectConfig(SPAM));
    await insertGrant({ userId: alice, mailboxId: boxA });
    await insertGrant({ userId: alice, mailboxId: boxB, ruleGroupId: deny });
    for (let i = 0; i < 15; i += 1) {
      await putMail({ address: "a@example.com", subject: `a${i}` });
      await putMail({ address: "b@example.com", subject: `b${i}` });
    }
    const { body } = await fetchMails("");
    expect(body.partial).toBe(true);
    expect(await mailIndexIds()).toHaveLength(MAX_PARSE_PER_REQUEST);
    // 重取直到解析完，结果仍然完整
    const done = await walk();
    expect(done.flat()).toHaveLength(30);
  });
});

describe("其他行为", () => {
  it("没有任何有效授权：空列表；只有一个授权：与指定该授权完全一致", async () => {
    expect(await settled("")).toEqual({ items: [], next_cursor: null, partial: false, next_after_id: null });
    const box = await insertMailbox("a@example.com");
    await insertGrant({ userId: alice, mailboxId: box });
    const id = await putMail({ address: "a@example.com", subject: "only" });
    const all = await settled("");
    expect(all.items.map((item) => item.id)).toEqual([id]);
    expect(all).toEqual(await settled(`?mailbox_id=${box}`));
  });

  it('"全部"请求为覆盖到的有效授权一并写入 first_access_at（过期的不写）', async () => {
    const [boxA, boxB, boxC] = [await insertMailbox("a@example.com"), await insertMailbox("b@example.com"), await insertMailbox("c@example.com")];
    const first = await insertRuleGroup("first", baseConfig({ time: { since: { type: "first_access" } } }));
    const g1 = await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: first });
    const g2 = await insertGrant({ userId: alice, mailboxId: boxB });
    const g3 = await insertGrant({ userId: alice, mailboxId: boxC, ruleGroupId: first, expiresAt: nowSec() - 1 });
    await fetchMails("");
    expect((await grantRow(g1))?.first_access_at).not.toBeNull();
    expect((await grantRow(g2))?.first_access_at).not.toBeNull();
    expect((await grantRow(g3))?.first_access_at).toBeNull();
  });

  it("规则组组合超过上限：422 too_many_scopes，不静默截断", async () => {
    for (let i = 0; i <= ME_ALL_MAX_SCOPES; i += 1) {
      const box = await insertMailbox(`box${i}@example.com`);
      const group = await insertRuleGroup(`g${i}`, baseConfig());
      await insertGrant({ userId: alice, mailboxId: box, ruleGroupId: group });
    }
    const { status, body } = await fetchMails("");
    expect(status).toBe(422);
    expect(body.error.code).toBe("too_many_scopes");
  });
});
