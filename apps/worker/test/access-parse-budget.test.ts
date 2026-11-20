import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { listVisibleMails, type ParseBudget } from "../src/access";
import { nowSec } from "../src/clock";
import { MAX_PARSE_PER_REQUEST } from "../src/constants";
import { latestMailId } from "../src/mail-source";
import { baseConfig, mailIndexIds, putMail, scopeOf } from "./access-helpers";
import { resetApp } from "./helpers";

// 可选的解析预算（多个作用域共用一次请求的解析量）与 latestMailId。

beforeEach(async () => {
  await resetApp();
});

const A = "a@example.com";
const B = "b@example.com";
const MAILS_PER_SCOPE = 15;

async function fill(address: string): Promise<void> {
  for (let i = 0; i < MAILS_PER_SCOPE; i += 1) await putMail({ address, subject: `m${i}` });
}

const list = (address: string, parseBudget?: ParseBudget) =>
  listVisibleMails(env, scopeOf([address]), { now: nowSec(), parseBudget });

describe("listVisibleMails 的 parseBudget", () => {
  it("不给时与以前一样：单次最多解析 MAX_PARSE_PER_REQUEST 封", async () => {
    await fill(A);
    const page = await list(A);
    expect(page.partial).toBe(true);
    expect(await mailIndexIds()).toHaveLength(MAX_PARSE_PER_REQUEST);
  });

  it("给了就按它的剩余量解析并递减；用完后没解析的邮件是 pending（partial）", async () => {
    await fill(A);
    const budget = { remaining: 3 };
    const page = await list(A, budget);
    expect(page.partial).toBe(true);
    expect(budget.remaining).toBe(0);
    expect(await mailIndexIds()).toHaveLength(3);
  });

  it("两个作用域共用一份预算：总解析量不超过预算，后一个只能用已建好的索引", async () => {
    await fill(A);
    await fill(B);
    const budget = { remaining: MAX_PARSE_PER_REQUEST };
    const first = await list(A, budget);
    const second = await list(B, budget);
    expect(first.partial).toBe(true);
    expect(second).toMatchObject({ items: [], partial: true });
    expect(await mailIndexIds()).toHaveLength(MAX_PARSE_PER_REQUEST);
    expect(budget.remaining).toBe(0);
  });

  it("max_mails 作用域同样消耗预算", async () => {
    await fill(A);
    const budget = { remaining: 4 };
    const scope = scopeOf([A], baseConfig({ limits: { max_mails: 5 } }));
    const page = await listVisibleMails(env, scope, { now: nowSec(), parseBudget: budget });
    expect(page.partial).toBe(true);
    expect(budget.remaining).toBe(0);
    expect(await mailIndexIds()).toHaveLength(4);
  });
});

describe("latestMailId", () => {
  it("没有邮件为 0；之后是全库最大 id（不论地址）", async () => {
    expect(await latestMailId(env.MAIL_DB)).toBe(0);
    await putMail({ address: A });
    const last = await putMail({ address: B });
    expect(await latestMailId(env.MAIL_DB)).toBe(last);
  });
});
