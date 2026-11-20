import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { getVisibleMailDetail } from "../src/access";
import { ApiError } from "../src/errors";
import type { MailIdentity } from "../src/mail-index";
import { buildMail, putMail, scopeOf } from "./access-helpers";
import { resetApp } from "./helpers";
import { d1Time, insertMail } from "./mail-helpers";

// FIN-A 补充：详情先取候选、再取原文，是两次查询。两次之间 id 被新邮件复用时，
// 原文已是新邮件，而 gate 判的是旧邮件的身份——必须按不可见处理（404），不能渲染新邮件。

const ADDRESS = "box@example.com";
const nowSec = () => Math.floor(Date.now() / 1000);

beforeEach(resetApp);

/** 包一层 MAIL_DB：第一次执行取原文的查询（SELECT id, raw …）之前先跑 hook，模拟此刻 id 被复用 */
function reuseBeforeRawFetch(db: D1Database, hook: () => Promise<void>): D1Database {
  let fired = false;
  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, prop) {
        if (prop === "bind") return (...values: unknown[]) => wrapStatement(target.bind(...values));
        if (prop === "all") {
          return async () => {
            if (!fired) {
              fired = true;
              await hook();
            }
            return target.all();
          };
        }
        const value: unknown = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => (/^SELECT id, raw\b/.test(sql) ? wrapStatement(target.prepare(sql)) : target.prepare(sql));
      }
      const value: unknown = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function reuseId(mailId: number): Promise<void> {
  await env.MAIL_DB.prepare("DELETE FROM raw_mails WHERE id = ?").bind(mailId).run();
  await insertMail({
    id: mailId,
    message_id: "<reused@example.org>",
    address: ADDRESS,
    raw: buildMail({ to: ADDRESS, subject: "Reused", text: "NEW MAIL 222222" }),
    created_at: d1Time(nowSec() - 10),
  });
}

describe("详情：候选与原文之间 id 被复用", () => {
  it("原文对不上 gate 判过的身份：404，不渲染新邮件", async () => {
    const mailId = await putMail({ address: ADDRESS, subject: "Original", text: "OLD MAIL 111111", ageSec: 60 });
    const seen: MailIdentity[] = [];
    const gate = async (identity: MailIdentity) => {
      seen.push(identity);
      return identity.message_id !== "<reused@example.org>";
    };
    const dbs = { APP_DB: env.APP_DB, MAIL_DB: reuseBeforeRawFetch(env.MAIL_DB, () => reuseId(mailId)) };
    const result = getVisibleMailDetail(dbs, scopeOf([ADDRESS]), mailId, { now: nowSec(), gate });
    await expect(result).rejects.toSatisfy((error) => error instanceof ApiError && error.status === 404);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.message_id).not.toBe("<reused@example.org>");
  });

  it("对照：没有复用时同一包装下照常返回原邮件", async () => {
    const mailId = await putMail({ address: ADDRESS, subject: "Original", text: "OLD MAIL 111111", ageSec: 60 });
    const dbs = { APP_DB: env.APP_DB, MAIL_DB: reuseBeforeRawFetch(env.MAIL_DB, async () => {}) };
    const mail = await getVisibleMailDetail(dbs, scopeOf([ADDRESS]), mailId, { now: nowSec(), gate: async () => true });
    expect(mail.text).toContain("OLD MAIL 111111");
  });
});
