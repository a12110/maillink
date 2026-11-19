import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_PARSE_PER_REQUEST, PARSER_VERSION } from "../src/constants";
import { getOrBuild, isFresh } from "../src/mail-index";
import type { IndexedItem } from "../src/mail-index";
import type { MailIndexRow } from "../src/mail-parse";
import { listCandidates } from "../src/mail-source";
import { resetApp } from "./helpers";
import { candidateOf, d1Time, fixture, gzipBytes, insertMail } from "./mail-helpers";

const ADDRESS = "box@example.com";
/** 只有 ok 状态才有 facts */
function facts(item: IndexedItem | undefined) {
  if (item?.status !== "ok") throw new Error(`期望 ok，实际 ${item?.status}`);
  return item.facts;
}
const candidates = () => listCandidates(env.MAIL_DB, { addresses: [ADDRESS], limit: 100 });

async function indexRow(id: number): Promise<MailIndexRow | null> {
  return await env.APP_DB.prepare("SELECT * FROM mail_index WHERE mail_id = ?1").bind(id).first<MailIndexRow>();
}

async function insertSimple(subject: string, extra: Parameters<typeof insertMail>[0] = {}): Promise<number> {
  return await insertMail({ address: ADDRESS, raw: `From: a@example.org\r\nTo: ${ADDRESS}\r\nSubject: ${subject}\r\n\r\nbody of ${subject}`, ...extra });
}

describe("getOrBuild", () => {
  beforeEach(resetApp);

  it("未命中：取原文、解析、写回索引（含 0003 新增的列）", async () => {
    const id = await insertMail({
      address: ADDRESS,
      raw: fixture("ai-extract-priority.eml"),
      metadata: JSON.stringify({ ai_extract: { type: "auth_code", result: "445566" } }),
    });
    const { items, partial } = await getOrBuild(env, await candidates());
    expect(partial).toBe(false);
    expect(items).toHaveLength(1);
    expect(facts(items[0])).toMatchObject({ mail_id: id, code: "445566", category: "verification", subject: "Sign in to Example" });

    const row = await indexRow(id);
    expect(row).toMatchObject({
      mail_id: id,
      parse_status: "ok",
      parse_error: null,
      parser_version: PARSER_VERSION,
      code: "445566",
      code_source: "ai_extract",
      from_address: "noreply@login.example.org",
      sender_address: '["noreply@login.example.org"]',
      sender_domain: '["login.example.org"]',
      recipient: ADDRESS,
      category: "verification",
      has_html: 0,
      body_truncated: 0,
    });
  });

  it("命中：不再读取原文、不重新解析", async () => {
    const id = await insertSimple("first");
    await getOrBuild(env, await candidates());
    const before = await indexRow(id);
    // 改掉 MAIL_DB 里的原文：命中时索引里的副本不应变化
    await env.MAIL_DB.prepare("UPDATE raw_mails SET raw = ?1 WHERE id = ?2").bind("From: a@example.org\r\nSubject: changed\r\n\r\nx", id).run();
    const { items } = await getOrBuild(env, await candidates());
    expect(facts(items[0])?.subject).toBe("first");
    expect(await indexRow(id)).toEqual(before);
  });

  it("解析器版本过期：重建并写回当前版本", async () => {
    const id = await insertSimple("v-old");
    await getOrBuild(env, await candidates());
    await env.APP_DB.prepare("UPDATE mail_index SET parser_version = ?1, subject = 'stale' WHERE mail_id = ?2").bind(PARSER_VERSION - 1, id).run();
    const { items } = await getOrBuild(env, await candidates());
    expect(facts(items[0])?.subject).toBe("v-old");
    expect((await indexRow(id))?.parser_version).toBe(PARSER_VERSION);
  });

  it("id 复用（message_id 不一致）：重建，不沿用旧内容", async () => {
    const id = await insertSimple("original", { message_id: "<one@test>" });
    await getOrBuild(env, await candidates());
    // 模拟 temp_email 清理后 id 被新邮件复用：同一个 id，不同的 message_id 与内容
    await env.MAIL_DB.prepare("UPDATE raw_mails SET message_id = ?1, raw = ?2 WHERE id = ?3")
      .bind("<two@test>", "From: b@example.org\r\nSubject: reused\r\n\r\nnew mail", id)
      .run();
    const { items } = await getOrBuild(env, await candidates());
    expect(facts(items[0])?.subject).toBe("reused");
    expect((await indexRow(id))?.message_id).toBe("<two@test>");
  });

  it("id 复用（received_at 不一致）：重建", async () => {
    const id = await insertSimple("original", { created_at: d1Time(1_800_000_000) });
    await getOrBuild(env, await candidates());
    await env.MAIL_DB.prepare("UPDATE raw_mails SET created_at = ?1, raw = ?2 WHERE id = ?3")
      .bind(d1Time(1_800_000_500), "From: b@example.org\r\nSubject: reused-time\r\n\r\nnew", id)
      .run();
    const { items } = await getOrBuild(env, await candidates());
    expect(facts(items[0])).toMatchObject({ subject: "reused-time", received_at: 1_800_000_500 });
  });

  it("isFresh：逐项比对 message_id / received_at / recipient / 版本", () => {
    const candidate = candidateOf({ id: 1, message_id: "<m>", received_at: 10, address: "a@b.c" });
    const row = { mail_id: 1, message_id: "<m>", received_at: 10, recipient: "a@b.c", parser_version: PARSER_VERSION } as MailIndexRow;
    expect(isFresh(row, candidate)).toBe(true);
    expect(isFresh({ ...row, message_id: "<x>" }, candidate)).toBe(false);
    expect(isFresh({ ...row, message_id: null }, candidate)).toBe(false);
    expect(isFresh({ ...row, received_at: 11 }, candidate)).toBe(false);
    expect(isFresh({ ...row, recipient: "z@b.c" }, candidate)).toBe(false);
    expect(isFresh({ ...row, parser_version: PARSER_VERSION + 1 }, candidate)).toBe(false);
    expect(isFresh({ ...row, message_id: null }, { ...candidate, message_id: null })).toBe(true);
  });

  it(`单次最多现场解析 MAX_PARSE_PER_REQUEST 封：超出的"未就绪"，partial=true；再取一次补齐`, async () => {
    const total = MAX_PARSE_PER_REQUEST + 3;
    for (let i = 0; i < total; i++) await insertSimple(`mail-${i}`);
    const list = await candidates();
    const first = await getOrBuild(env, list);
    expect(first.partial).toBe(true);
    expect(first.items).toHaveLength(total);
    expect(first.items.filter((item) => item.status !== "pending")).toHaveLength(MAX_PARSE_PER_REQUEST);
    // 按候选顺序（id 倒序）轮到解析，未就绪的是排在后面的
    expect(first.items.slice(MAX_PARSE_PER_REQUEST).every((item) => item.status === "pending")).toBe(true);

    const second = await getOrBuild(env, list);
    // 前 10 封已在索引里，这次只需要解析剩下的 3 封
    expect(second.partial).toBe(false);
    expect(second.items.every((item) => item.status !== "pending")).toBe(true);
  });

  it("可以用 maxParse 调整上限", async () => {
    for (let i = 0; i < 4; i++) await insertSimple(`mail-${i}`);
    const result = await getOrBuild(env, await candidates(), { maxParse: 1 });
    expect(result.partial).toBe(true);
    expect(result.items.filter((item) => item.status !== "pending")).toHaveLength(1);
  });

  it("过期的行没轮到重建时也不返回（不拿旧解析结果做判定）", async () => {
    const id = await insertSimple("keep");
    await getOrBuild(env, await candidates());
    await env.APP_DB.prepare("UPDATE mail_index SET parser_version = 0 WHERE mail_id = ?1").bind(id).run();
    const result = await getOrBuild(env, await candidates(), { maxParse: 0 });
    expect(result.items[0]?.status).toBe("pending");
    expect(result.partial).toBe(true);
  });

  it("解析失败：写 parse_status=failed 与错误信息，不影响同批其他邮件", async () => {
    const good = await insertSimple("good");
    const malformed = await insertMail({ address: ADDRESS, raw: fixture("malformed.eml") });
    const empty = await insertMail({ address: ADDRESS, raw: null, raw_blob: null });
    const result = await getOrBuild(env, await candidates());
    expect(result.partial).toBe(false);
    const byId = new Map(result.items.map((item) => [item.candidate.id, item]));
    expect(byId.get(good)?.status).toBe("ok");
    expect(byId.get(malformed)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("邮件头"),
      row: { parse_status: "failed", subject: null },
    });
    expect(byId.get(empty)).toMatchObject({ status: "failed", error: expect.stringContaining("均为空") });
    // 失败项在类型和运行时都没有 facts
    expect("facts" in (byId.get(malformed) ?? {})).toBe(false);
    // 失败的结果也被缓存：下次直接命中，不再重复解析
    expect((await indexRow(malformed))?.parse_status).toBe("failed");
  });

  it("gzip 存储的邮件：解压后解析", async () => {
    const id = await insertMail({ address: ADDRESS, raw: null, raw_blob: await gzipBytes(fixture("gzip-blob.eml")) });
    const { items } = await getOrBuild(env, await candidates());
    expect(facts(items[0])).toMatchObject({ mail_id: id, code: "907351", subject: "New sign-in code: 907351" });
  });

  it("原文已被删除的邮件：不返回（不是未就绪）", async () => {
    const id = await insertSimple("vanishing");
    const list = await candidates();
    await env.MAIL_DB.prepare("DELETE FROM raw_mails WHERE id = ?1").bind(id).run();
    const result = await getOrBuild(env, list);
    expect(result.items).toEqual([]);
    expect(result.partial).toBe(false);
    expect(await indexRow(id)).toBeNull();
  });

  it("没有候选时什么都不做", async () => {
    expect(await getOrBuild(env, [])).toEqual({ items: [], partial: false });
  });

  it("超长正文：索引里存截断副本并标记", async () => {
    const { buildLargeMail } = await import("./fixtures/build-large-mail");
    const id = await insertMail({ address: ADDRESS, raw: buildLargeMail() });
    await getOrBuild(env, await candidates());
    const row = await indexRow(id);
    expect(row?.body_truncated).toBe(1);
    expect(new TextEncoder().encode(row?.body_text ?? "").length).toBeLessThanOrEqual(32_768);
  });
});
