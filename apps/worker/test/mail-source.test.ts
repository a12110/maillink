import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { IMPORTED_SCOPE_MAX_ADDRESSES, RAW_FETCH_CHUNK } from "../src/constants";
import { ApiError } from "../src/errors";
import {
  expandAddressForms,
  getCandidateById,
  getRawBatch,
  listAdminMails,
  listAfter,
  listCandidates,
  MAIL_DB_UNHEALTHY_CODE,
} from "../src/mail-source";
import { d1Time, gzipBytes, insertMail } from "./mail-helpers";
import { setupMailDb } from "./helpers";

const db = () => env.MAIL_DB;
const ids = (rows: Array<{ id: number }>) => rows.map((row) => row.id);

describe("地址的两种形式", () => {
  it("原样（域名小写）与全小写，去重", () => {
    expect(expandAddressForms(["Alice.Smith@Example.COM"])).toEqual(["Alice.Smith@example.com", "alice.smith@example.com"]);
    expect(expandAddressForms(["alice@example.com", "alice@EXAMPLE.com"])).toEqual(["alice@example.com"]);
  });
});

describe("listCandidates", () => {
  beforeEach(() => setupMailDb());

  it("按 to_address 匹配；两种大小写形式都能命中，别的写法不命中", async () => {
    const original = await insertMail({ address: "fwd@example.com", to_address: "Alice@example.com" });
    const lower = await insertMail({ address: "fwd@example.com", to_address: "alice@example.com" });
    await insertMail({ address: "fwd@example.com", to_address: "ALICE@example.com" });
    await insertMail({ address: "fwd@example.com", to_address: "bob@example.com" });
    const rows = await listCandidates(db(), { addresses: ["Alice@Example.COM"], limit: 10 });
    expect(ids(rows)).toEqual([lower, original]);
    expect(rows[0]).toMatchObject({ recipient: "alice@example.com", to_address: "alice@example.com", address: "fwd@example.com" });
    expect(rows[1]?.recipient).toBe("alice@example.com");
  });

  it("to_address 为空（NULL 或空串）时回退到 address；to_address 有值时 address 不参与", async () => {
    const viaNull = await insertMail({ address: "plain@example.com", to_address: null });
    const viaEmpty = await insertMail({ address: "plain@example.com", to_address: "" });
    await insertMail({ address: "plain@example.com", to_address: "other@icloud.com" });
    expect(ids(await listCandidates(db(), { addresses: ["plain@example.com"], limit: 10 }))).toEqual([viaEmpty, viaNull]);
  });

  it("时间下界：created_at >= since（含边界），单位是 Unix 秒", async () => {
    const base = 1_800_000_000;
    const old = await insertMail({ address: "a@example.com", created_at: d1Time(base - 1) });
    const edge = await insertMail({ address: "a@example.com", created_at: d1Time(base) });
    const newer = await insertMail({ address: "a@example.com", created_at: d1Time(base + 60) });
    const rows = await listCandidates(db(), { addresses: ["a@example.com"], since: base, limit: 10 });
    expect(ids(rows)).toEqual([newer, edge]);
    expect(ids(rows)).not.toContain(old);
    expect(rows[1]?.received_at).toBe(base);
  });

  it("游标：id < beforeId，倒序，limit 生效", async () => {
    const all = [];
    for (let i = 0; i < 5; i++) all.push(await insertMail({ address: "a@example.com" }));
    const page1 = await listCandidates(db(), { addresses: ["a@example.com"], limit: 2 });
    expect(ids(page1)).toEqual([all[4], all[3]]);
    const page2 = await listCandidates(db(), { addresses: ["a@example.com"], beforeId: all[3], limit: 2 });
    expect(ids(page2)).toEqual([all[2], all[1]]);
  });

  it("多个地址与空地址列表", async () => {
    const a = await insertMail({ address: "a@example.com" });
    const b = await insertMail({ address: "b@example.com" });
    await insertMail({ address: "c@example.com" });
    expect(ids(await listCandidates(db(), { addresses: ["a@example.com", "B@example.com"], limit: 10 }))).toEqual([b, a]);
    expect(await listCandidates(db(), { addresses: [], limit: 10 })).toEqual([]);
  });

  it("超过 100 个地址也能查（走 json_each，不受绑定参数个数限制）", async () => {
    const target = await insertMail({ address: "addr-150@example.com" });
    const addresses = Array.from({ length: 300 }, (_, i) => `addr-${i}@example.com`);
    expect(ids(await listCandidates(db(), { addresses, limit: 10 }))).toEqual([target]);
  });

  it("不取正文：候选里没有 raw / raw_blob / metadata", async () => {
    await insertMail({ address: "a@example.com", raw: "Subject: x\r\n\r\nbody" });
    const [row] = await listCandidates(db(), { addresses: ["a@example.com"], limit: 1 });
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ["address", "id", "message_id", "received_at", "recipient", "source", "to_address"],
    );
  });
});

describe("listAfter（增量轮询）", () => {
  beforeEach(() => setupMailDb());

  it("id > afterId，正序，受 limit 与时间下界约束", async () => {
    const base = 1_800_000_000;
    const first = await insertMail({ address: "a@example.com", created_at: d1Time(base) });
    const second = await insertMail({ address: "a@example.com", created_at: d1Time(base + 10) });
    const third = await insertMail({ address: "a@example.com", created_at: d1Time(base + 20) });
    await insertMail({ address: "other@example.com" });
    expect(ids(await listAfter(db(), { addresses: ["a@example.com"], afterId: first, limit: 10 }))).toEqual([second, third]);
    expect(ids(await listAfter(db(), { addresses: ["a@example.com"], afterId: 0, limit: 2 }))).toEqual([first, second]);
    expect(ids(await listAfter(db(), { addresses: ["a@example.com"], afterId: 0, since: base + 10, limit: 10 }))).toEqual([second, third]);
    expect(await listAfter(db(), { addresses: ["a@example.com"], afterId: third, limit: 10 })).toEqual([]);
  });
});

describe("缺 to_address 列", () => {
  beforeEach(() => setupMailDb({ omitColumns: ["to_address"] }));
  const COLUMNS = ["source", "address", "raw", "created_at", "message_id"];

  it("只按 address 匹配，候选的 to_address 恒为 null，recipient 取 address", async () => {
    const id = await insertMail({ address: "Plain@example.com" }, COLUMNS);
    await insertMail({ address: "other@example.com" }, COLUMNS);
    const rows = await listCandidates(db(), { addresses: ["Plain@Example.com"], limit: 10 });
    expect(ids(rows)).toEqual([id]);
    expect(rows[0]).toMatchObject({ to_address: null, recipient: "plain@example.com" });
  });

  it("管理员按 to_address 过滤：明确报 400，而不是静默忽略", async () => {
    const error = await listAdminMails(db(), { scope: "all", toAddress: "a@b.c", limit: 5 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: "to_address_unsupported" });
  });
});

describe("MAIL_DB 不健康", () => {
  it("缺必需列：所有读取函数抛 503 mail_db_unhealthy", async () => {
    await setupMailDb({ omitColumns: ["raw"] });
    const attempts = [
      () => listCandidates(db(), { addresses: ["a@b.c"], limit: 1 }),
      () => listAfter(db(), { addresses: ["a@b.c"], afterId: 0, limit: 1 }),
      () => getCandidateById(db(), 1),
      () => getRawBatch(db(), [1]),
      () => listAdminMails(db(), { scope: "all", limit: 1 }),
    ];
    for (const attempt of attempts) {
      const error = await attempt().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 503, code: MAIL_DB_UNHEALTHY_CODE });
      expect((error as ApiError).message).toContain("raw");
    }
  });

  it("表不存在：503", async () => {
    await setupMailDb({ rawMails: false });
    const error = await getRawBatch(db(), [1]).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503, code: MAIL_DB_UNHEALTHY_CODE });
  });

  it("修复后无需重启即可恢复（不健康结果不缓存）", async () => {
    await setupMailDb({ omitColumns: ["raw"] });
    await expect(getRawBatch(db(), [1])).rejects.toBeInstanceOf(ApiError);
    await setupMailDb();
    // setupMailDb 会清缓存；这里验证的是健康后能正常查询
    expect(await getRawBatch(db(), [1])).toEqual([]);
  });
});

describe("getRawBatch", () => {
  beforeEach(() => setupMailDb());

  it("非 gzip：读 raw，并带回 metadata 原文", async () => {
    const id = await insertMail({ raw: "Subject: plain\r\n\r\nhello", metadata: '{"ai_extract":{"type":"auth_code","result":"1"}}' });
    const [result] = await getRawBatch(db(), [id]);
    expect(result).toEqual({ ok: true, id, raw: "Subject: plain\r\n\r\nhello", metadata: '{"ai_extract":{"type":"auth_code","result":"1"}}' });
  });

  it("gzip：raw_blob 解压成原文（含多字节字符），raw 为空", async () => {
    const text = "Subject: 压缩\r\n\r\n正文 with 😀";
    const id = await insertMail({ raw: null, raw_blob: await gzipBytes(text) });
    const [result] = await getRawBatch(db(), [id]);
    expect(result).toMatchObject({ ok: true, id, raw: text, metadata: null });
  });

  it("raw 与 raw_blob 都为空：明确报错，不返回空串", async () => {
    const nothing = await insertMail({ raw: null, raw_blob: null });
    const emptyString = await insertMail({ raw: "", raw_blob: null });
    const results = await getRawBatch(db(), [nothing, emptyString]);
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ error: expect.stringContaining("均为空") });
    }
  });

  it("raw_blob 不是合法 gzip：该封报错，不回退到 raw", async () => {
    const id = await insertMail({ raw: "should not be used", raw_blob: new TextEncoder().encode("not gzip").buffer as ArrayBuffer });
    const [result] = await getRawBatch(db(), [id]);
    expect(result).toMatchObject({ ok: false, id, error: expect.stringContaining("解压失败") });
  });

  it("按 RAW_FETCH_CHUNK 分批：超过一批也全部取回，已删除的 id 不出现在结果里", async () => {
    const count = RAW_FETCH_CHUNK * 2 + 3;
    const all: number[] = [];
    for (let i = 0; i < count; i++) all.push(await insertMail({ raw: `Subject: m${i}\r\n\r\nx` }));
    const results = await getRawBatch(db(), [...all, 99_999]);
    expect(results.map((r) => r.id).sort((a, b) => a - b)).toEqual(all);
    expect(await getRawBatch(db(), [])).toEqual([]);
  });

  it("缺 raw_blob 列：只读 raw；缺 metadata 列：metadata 为 null", async () => {
    await setupMailDb({ omitColumns: ["raw_blob", "metadata"] });
    const id = await insertMail({ raw: "Subject: x\r\n\r\ny" }, ["source", "address", "to_address", "raw", "created_at", "message_id"]);
    const [result] = await getRawBatch(db(), [id]);
    expect(result).toEqual({ ok: true, id, raw: "Subject: x\r\n\r\ny", metadata: null });
  });
});

describe("listAdminMails", () => {
  beforeEach(() => setupMailDb());

  async function seed() {
    const base = 1_800_000_000;
    return {
      a: await insertMail({ address: "fwd@example.com", to_address: "Known@example.com", source: "Alpha@Sender.org", created_at: d1Time(base) }),
      b: await insertMail({ address: "plain@example.com", to_address: null, source: "beta@sender.org", created_at: d1Time(base + 100) }),
      c: await insertMail({ address: "fwd@example.com", to_address: "stranger@example.com", source: "gamma@other.org", created_at: d1Time(base + 200) }),
      base,
    };
  }

  it("不带条件：全部，id 倒序", async () => {
    const { a, b, c } = await seed();
    expect(ids(await listAdminMails(db(), { scope: "all", limit: 10 }))).toEqual([c, b, a]);
  });

  it("address（信封收件人）/ to_address（邮件头收件人）/ source（信封发件人，不区分大小写）", async () => {
    const { a, b, c } = await seed();
    expect(ids(await listAdminMails(db(), { scope: "all", address: "fwd@example.com", limit: 10 }))).toEqual([c, a]);
    expect(ids(await listAdminMails(db(), { scope: "all", address: "PLAIN@example.com", limit: 10 }))).toEqual([b]);
    expect(ids(await listAdminMails(db(), { scope: "all", toAddress: "known@example.com", limit: 10 }))).toEqual([a]);
    expect(ids(await listAdminMails(db(), { scope: "all", source: "alpha@sender.ORG", limit: 10 }))).toEqual([a]);
    expect(ids(await listAdminMails(db(), { scope: "all", address: "fwd@example.com", source: "gamma@other.org", limit: 10 }))).toEqual([c]);
  });

  it("时间范围含边界", async () => {
    const { b, base } = await seed();
    expect(ids(await listAdminMails(db(), { scope: "all", since: base + 100, until: base + 100, limit: 10 }))).toEqual([b]);
    expect(ids(await listAdminMails(db(), { scope: "all", since: base + 101, until: base + 199, limit: 10 }))).toEqual([]);
  });

  it("范围：已导入地址只匹配收件人（to_address，空则 address）；未知地址是它的补集", async () => {
    const { a, b, c } = await seed();
    // mailboxes.address 是导入时的写法（域名小写，本地部分保留原样）
    const importedAddresses = ["Known@example.com", "plain@example.com"];
    expect(ids(await listAdminMails(db(), { scope: "imported", importedAddresses, limit: 10 }))).toEqual([b, a]);
    expect(ids(await listAdminMails(db(), { scope: "unknown", importedAddresses, limit: 10 }))).toEqual([c]);
    // 信封地址 fwd@ 不是收件人：导入它不会让 a、c 变成已导入
    expect(ids(await listAdminMails(db(), { scope: "imported", importedAddresses: ["fwd@example.com"], limit: 10 }))).toEqual([]);
  });

  it("范围：没有已导入地址时，imported 为空、unknown 等于全部", async () => {
    const { a, b, c } = await seed();
    expect(await listAdminMails(db(), { scope: "imported", importedAddresses: [], limit: 10 })).toEqual([]);
    expect(ids(await listAdminMails(db(), { scope: "unknown", importedAddresses: [], limit: 10 }))).toEqual([c, b, a]);
  });

  it("范围：已导入地址超过上限时明确报 422，不静默截断", async () => {
    const importedAddresses = Array.from({ length: IMPORTED_SCOPE_MAX_ADDRESSES + 1 }, (_, i) => `u${i}@example.com`);
    const error = await listAdminMails(db(), { scope: "imported", importedAddresses, limit: 10 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 422, code: "scope_too_large" });
  });

  it("范围：上限以内的大批量地址（上千个）可以查", async () => {
    const { b } = await seed();
    const importedAddresses = [...Array.from({ length: 3000 }, (_, i) => `u${i}@example.com`), "plain@example.com"];
    expect(ids(await listAdminMails(db(), { scope: "imported", importedAddresses, limit: 10 }))).toEqual([b]);
  });

  it("翻页：beforeId 倒序；增量：afterId 正序", async () => {
    const { a, b, c } = await seed();
    expect(ids(await listAdminMails(db(), { scope: "all", beforeId: c, limit: 10 }))).toEqual([b, a]);
    expect(ids(await listAdminMails(db(), { scope: "all", afterId: a, limit: 10 }))).toEqual([b, c]);
    expect(ids(await listAdminMails(db(), { scope: "all", afterId: a, limit: 1 }))).toEqual([b]);
  });
});

describe("getCandidateById", () => {
  beforeEach(() => setupMailDb());

  it("存在时返回候选，不存在返回 null", async () => {
    const id = await insertMail({ address: "A@Example.com", to_address: "To@Example.com", source: "s@x.org", message_id: "<mid>" });
    expect(await getCandidateById(db(), id)).toMatchObject({ id, message_id: "<mid>", source: "s@x.org", recipient: "to@example.com" });
    expect(await getCandidateById(db(), 424_242)).toBeNull();
  });
});
