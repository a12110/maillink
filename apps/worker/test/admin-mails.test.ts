import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { AdminMailDetail, AdminMailListResponse } from "@maillink/shared";
import { IMPORTED_SCOPE_MAX_ADDRESSES, LIST_PAGE_SIZE, MAX_PARSE_PER_REQUEST } from "../src/constants";
import { adminSession, api, createSessionCookie, createUser, resetApp, setupMailDb } from "./helpers";
import { buildLargeMail } from "./fixtures/build-large-mail";
import { d1Time, fixture, gzipBytes, insertMail } from "./mail-helpers";

type ErrorBody = { error: { code: string; message: string } };

let cookie = "";
beforeEach(async () => {
  await resetApp();
  cookie = (await adminSession()).cookie;
});

const list = async (query = ""): Promise<AdminMailListResponse> => {
  const res = await api(`/api/admin/mails${query}`, { cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as AdminMailListResponse;
};

const detail = async (id: number, query = ""): Promise<AdminMailDetail> => {
  const res = await api(`/api/admin/mails/${id}${query}`, { cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as AdminMailDetail;
};

describe("访问控制", () => {
  const PATHS = ["/api/admin/mails", "/api/admin/mails/1", "/api/admin/mails/1/attachments/0"];

  it("未登录 401，普通用户 403", async () => {
    const userId = await createUser({ username: "plain" });
    const userCookie = (await createSessionCookie(userId)).cookie;
    for (const path of PATHS) {
      const anonymous = await api(path);
      expect(anonymous.status, path).toBe(401);
      expect(((await anonymous.json()) as ErrorBody).error.code).toBe("unauthenticated");
      const user = await api(path, { cookie: userCookie });
      expect(user.status, path).toBe(403);
      expect(((await user.json()) as ErrorBody).error.code).toBe("forbidden");
    }
  });
});

describe("GET /api/admin/mails", () => {
  it("列表项：收件人、展示用发件人（From）、主题、时间、附件、验证码、分类、解析状态；no-store", async () => {
    const zh = await insertMail({ address: "zh@example.com", source: "noreply@account.example.cn", raw: fixture("verification-code-zh.eml") });
    const att = await insertMail({ address: "plain@example.com", raw: fixture("attachment.eml") });
    const res = await api("/api/admin/mails", { cookie });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as AdminMailListResponse;
    expect(body.partial).toBe(false);
    expect(body.next_cursor).toBeNull();
    expect(body.items.map((item) => item.id)).toEqual([att, zh]);
    expect(body.items[1]).toMatchObject({
      id: zh,
      recipient: "zh@example.com",
      sender: { address: "noreply@account.example.cn", name: "Example 账号" },
      envelope: "noreply@account.example.cn",
      parse_status: "ok",
      subject: "【Example】您的登录验证码",
      has_attachment: false,
      code: "704512",
      category: "verification",
      received_at: expect.any(Number),
    });
    expect(body.items[0]).toMatchObject({ has_attachment: true, code: null, category: "other" });
  });

  it("HME 邮件：列表展示 From；gzip 邮件正常解压", async () => {
    const hme = await insertMail({
      address: "mailbox@example.com",
      to_address: "hme.alias.7k2@icloud.com",
      raw: fixture("icloud-hme-forward.eml"),
    });
    const gz = await insertMail({ address: "plain@example.com", raw: null, raw_blob: await gzipBytes(fixture("gzip-blob.eml")) });
    const { items } = await list();
    expect(items.find((item) => item.id === hme)).toMatchObject({
      recipient: "hme.alias.7k2@icloud.com",
      sender: { address: "no-reply@accounts.example.net" },
      code: "482913",
    });
    expect(items.find((item) => item.id === gz)).toMatchObject({ parse_status: "ok", code: "907351" });
  });

  it("解析失败的邮件：列表里明确标记 failed，其余字段为空，其他邮件不受影响", async () => {
    const good = await insertMail({ address: "a@example.com", raw: fixture("verification-code-spaced.eml") });
    const bad = await insertMail({ address: "a@example.com", source: "unknown@nowhere.example.org", raw: fixture("malformed.eml") });
    const empty = await insertMail({ address: "a@example.com", raw: null, raw_blob: null });
    const { items, partial } = await list();
    expect(partial).toBe(false);
    expect(items.find((item) => item.id === good)?.parse_status).toBe("ok");
    expect(items.find((item) => item.id === bad)).toMatchObject({
      parse_status: "failed",
      envelope: "unknown@nowhere.example.org",
      subject: null,
      code: null,
      category: null,
      sender: null,
    });
    expect(items.find((item) => item.id === empty)?.parse_status).toBe("failed");
  });

  it("过滤：address / to_address / source / 时间范围", async () => {
    const base = 1_800_000_000;
    const raw = (subject: string) => `From: a@example.org\r\nSubject: ${subject}\r\n\r\nx`;
    const a = await insertMail({ address: "fwd@example.com", to_address: "Known@example.com", source: "alpha@sender.org", raw: raw("a"), created_at: d1Time(base) });
    const b = await insertMail({ address: "plain@example.com", source: "beta@sender.org", raw: raw("b"), created_at: d1Time(base + 100) });
    const c = await insertMail({ address: "fwd@example.com", to_address: "stranger@example.com", source: "gamma@other.org", raw: raw("c"), created_at: d1Time(base + 200) });
    const idsOf = async (query: string) => (await list(query)).items.map((item) => item.id);
    expect(await idsOf("")).toEqual([c, b, a]);
    expect(await idsOf("?address=fwd@example.com")).toEqual([c, a]);
    expect(await idsOf("?to_address=known@example.com")).toEqual([a]);
    expect(await idsOf("?source=BETA@sender.org")).toEqual([b]);
    expect(await idsOf(`?since=${base + 50}&until=${base + 150}`)).toEqual([b]);
    expect(await idsOf("?address=nobody@example.com")).toEqual([]);
  });

  it("范围：已导入地址 / 未知地址（来自 APP_DB.mailboxes）", async () => {
    const raw = "From: a@example.org\r\nSubject: s\r\n\r\nx";
    const known = await insertMail({ address: "fwd@example.com", to_address: "Known@example.com", raw });
    const plain = await insertMail({ address: "plain@example.com", raw });
    const stranger = await insertMail({ address: "fwd@example.com", to_address: "stranger@example.com", raw });
    await env.APP_DB.batch(
      ["Known@example.com", "plain@example.com"].map((address) =>
        env.APP_DB.prepare("INSERT INTO mailboxes (address, address_lc, created_at, updated_at) VALUES (?1, ?2, 0, 0)").bind(address, address.toLowerCase()),
      ),
    );
    const idsOf = async (query: string) => (await list(query)).items.map((item) => item.id);
    expect(await idsOf("?scope=imported")).toEqual([plain, known]);
    expect(await idsOf("?scope=unknown")).toEqual([stranger]);
    expect(await idsOf("?scope=all")).toEqual([stranger, plain, known]);
  });

  it("范围：已导入地址超过上限 422 scope_too_large，改用 all 仍可用", async () => {
    await insertMail({ address: "a@example.com", raw: "From: a@example.org\r\nSubject: s\r\n\r\nx" });
    await env.APP_DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
       INSERT INTO mailboxes (address, address_lc, created_at, updated_at)
       SELECT 'u' || i || '@example.com', 'u' || i || '@example.com', 0, 0 FROM n`,
    ).bind(IMPORTED_SCOPE_MAX_ADDRESSES + 1).run();
    const res = await api("/api/admin/mails?scope=imported", { cookie });
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe("scope_too_large");
    expect((await list("?scope=all")).items).toHaveLength(1);
  });

  it("游标翻页：limit、next_cursor，最后一页为 null", async () => {
    const all: number[] = [];
    for (let i = 0; i < 5; i++) all.push(await insertMail({ address: "a@example.com", raw: `From: a@example.org\r\nSubject: m${i}\r\n\r\nx` }));
    const page1 = await list("?limit=2");
    expect(page1.items.map((item) => item.id)).toEqual([all[4], all[3]]);
    expect(page1.next_cursor).toBe(String(all[3]));
    const page2 = await list(`?limit=2&cursor=${page1.next_cursor}`);
    expect(page2.items.map((item) => item.id)).toEqual([all[2], all[1]]);
    const page3 = await list(`?limit=2&cursor=${page2.next_cursor}`);
    expect(page3.items.map((item) => item.id)).toEqual([all[0]]);
    expect(page3.next_cursor).toBeNull();
    // 恰好一页：没有下一页
    expect((await list("?limit=5")).next_cursor).toBeNull();
  });

  it("增量轮询：after_id 只返回更新的邮件，新的在前，next_cursor 恒为 null", async () => {
    const first = await insertMail({ address: "a@example.com", raw: "From: a@example.org\r\nSubject: one\r\n\r\nx" });
    const second = await insertMail({ address: "a@example.com", raw: "From: a@example.org\r\nSubject: two\r\n\r\nx" });
    const third = await insertMail({ address: "a@example.com", raw: "From: a@example.org\r\nSubject: three\r\n\r\nx" });
    const body = await list(`?after_id=${first}`);
    expect(body.items.map((item) => item.id)).toEqual([third, second]);
    expect(body.next_cursor).toBeNull();
    expect((await list(`?after_id=${third}`)).items).toEqual([]);
    // 一次取不完时从最旧的一端开始，调用方用返回的最大 id 继续
    expect((await list(`?after_id=0&limit=2`)).items.map((item) => item.id)).toEqual([second, first]);
  });

  it("partial：超出单次解析上限的邮件以 pending 占位，稍后重取补齐", async () => {
    const total = MAX_PARSE_PER_REQUEST + 2;
    for (let i = 0; i < total; i++) await insertMail({ address: "a@example.com", raw: `From: a@example.org\r\nSubject: m${i}\r\n\r\nx` });
    const first = await list(`?limit=${total}`);
    expect(first.partial).toBe(true);
    expect(first.items).toHaveLength(total);
    const pending = first.items.filter((item) => item.parse_status === "pending");
    expect(pending).toHaveLength(2);
    expect(pending[0]).toMatchObject({ subject: null, code: null, category: null, sender: null, recipient: "a@example.com" });
    const second = await list(`?limit=${total}`);
    expect(second.partial).toBe(false);
    expect(second.items.every((item) => item.parse_status === "ok")).toBe(true);
  });

  it("默认每页 LIST_PAGE_SIZE 封", async () => {
    for (let i = 0; i < LIST_PAGE_SIZE + 2; i++) await insertMail({ address: "a@example.com", raw: "From: a@example.org\r\nSubject: s\r\n\r\nx" });
    const body = await list();
    expect(body.items).toHaveLength(LIST_PAGE_SIZE);
    expect(body.next_cursor).not.toBeNull();
  });

  it("参数校验：id 最多 15 位；since / until 不能超过 9999 年", async () => {
    for (const query of ["?cursor=1234567890123456", "?since=253402300800", "?until=99999999999999", "?after_id=9007199254740993"]) {
      const res = await api(`/api/admin/mails${query}`, { cookie });
      expect(res.status, query).toBe(400);
    }
    expect((await api("/api/admin/mails?cursor=123456789012345", { cookie })).status).toBe(200);
    expect((await api("/api/admin/mails?until=253402300799", { cookie })).status).toBe(200);
  });

  it("参数校验：非法值 400，cursor 与 after_id 互斥", async () => {
    for (const query of ["?limit=0", "?limit=101", "?scope=bogus", "?cursor=abc", "?since=x", "?cursor=5&after_id=3", "?since=10&until=5"]) {
      const res = await api(`/api/admin/mails${query}`, { cookie });
      expect(res.status, query).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe("validation_error");
    }
  });
});

describe("GET /api/admin/mails/:id", () => {
  it("解析结果：发件人候选、信封、正文、链接、附件、验证码与来源、分类、邮件头；不返回 HTML 与原文", async () => {
    const id = await insertMail({
      address: "mailbox@example.com",
      to_address: "hme.alias.7k2@icloud.com",
      source: "bounce+hme@example.net",
      raw: fixture("icloud-hme-forward.eml").replace("s=no-reply@accounts.example.net", "s=orig@service.example.org"),
    });
    const body = await detail(id);
    expect(body).toMatchObject({
      id,
      recipient: "hme.alias.7k2@icloud.com",
      envelope: { source: "bounce+hme@example.net", address: "mailbox@example.com", to_address: "hme.alias.7k2@icloud.com" },
      parse_status: "ok",
      parse_error: null,
    });
    expect(body.parsed).toMatchObject({
      subject: "Your Example verification code is 482913",
      from: { address: "no-reply@accounts.example.net", name: "Example Accounts" },
      sender_candidates: {
        addresses: ["no-reply@accounts.example.net", "orig@service.example.org"],
        domains: ["accounts.example.net", "service.example.org"],
      },
      code: "482913",
      code_source: "builtin",
      category: "verification",
      has_html: false,
      body_truncated: false,
    });
    expect(body.parsed?.headers.find((header) => header.key.toLowerCase() === "x-icloud-hme")?.value).toContain("p=hme.alias.7k2@icloud.com");
    expect("raw" in body).toBe(false);
    expect("html" in (body.parsed ?? {})).toBe(false);
  });

  it("HME p= 与收件地址不一致：候选里没有 s=", async () => {
    const id = await insertMail({ address: "mailbox@example.com", to_address: "hme.alias.7k2@icloud.com", raw: fixture("icloud-hme-mismatch.eml") });
    expect((await detail(id)).parsed?.sender_candidates.addresses).toEqual(["no-reply@accounts.example.net"]);
  });

  it("gzip 邮件：详情与 ?raw=1 都能看到解压后的内容", async () => {
    const id = await insertMail({ address: "plain@example.com", raw: null, raw_blob: await gzipBytes(fixture("gzip-blob.eml")) });
    const body = await detail(id, "?raw=1");
    expect(body.parsed?.code).toBe("907351");
    expect(body.raw).toBe(fixture("gzip-blob.eml"));
    expect((await detail(id, "?raw=0")).raw).toBeUndefined();
  });

  it("解析失败：详情标记 failed 与错误信息，?raw=1 仍能看原文", async () => {
    const id = await insertMail({ address: "a@example.com", raw: fixture("malformed.eml") });
    const body = await detail(id, "?raw=1");
    expect(body).toMatchObject({ parse_status: "failed", parsed: null, raw_size: null, raw: fixture("malformed.eml") });
    expect(body.parse_error).toContain("邮件头");
  });

  it("原文丢失（raw 与 raw_blob 都空）：failed，没有 raw 字段", async () => {
    const id = await insertMail({ address: "a@example.com", raw: null, raw_blob: null });
    const body = await detail(id, "?raw=1");
    expect(body).toMatchObject({ parse_status: "failed", parsed: null });
    expect(body.parse_error).toContain("均为空");
    expect(body.raw).toBeUndefined();
  });

  it("正文超过 32 KB：详情返回更长的正文（管理员上限更大）", async () => {
    const id = await insertMail({ address: "a@example.com", raw: buildLargeMail() });
    const body = await detail(id);
    expect(body.parsed?.body_truncated).toBe(false);
    expect(new TextEncoder().encode(body.parsed?.body ?? "").length).toBeGreaterThan(32_768);
    expect(body.parsed?.body).toContain("END-OF-LARGE-BODY");
  });

  it("详情正文是展示文本：保留换行；索引里的判定文本仍是单行", async () => {
    const id = await insertMail({ address: "a@example.com", raw: fixture("multiline-text.eml") });
    const body = await detail(id);
    expect(body.parsed?.body).toBe("Hi team,\n\nNotes from today:\n- item one\n- item two\n\nThanks,\nExample");
    await list();
    const row = await env.APP_DB.prepare("SELECT body_text FROM mail_index WHERE mail_id = ?1").bind(id).first<{ body_text: string }>();
    expect(row?.body_text).toBe("Hi team, Notes from today: - item one - item two Thanks, Example");
  });

  it("HTML 邮件的详情正文：段落换行，script 内容不出现", async () => {
    const id = await insertMail({ address: "a@example.com", raw: fixture("html-newsletter.eml") });
    const body = (await detail(id)).parsed?.body ?? "";
    expect(body).toContain("\n");
    expect(body).not.toContain("synthetic = ");
  });

  it("html 邮件：返回清洗并包装后的 HTML（CSP meta 开头），无脚本；远程图片默认阻止，可 ?remote_images=allow", async () => {
    const id = await insertMail({ address: "a@example.com", raw: fixture("html-newsletter.eml") });
    const body = await detail(id, "?raw=0");
    expect(body.parsed?.has_html).toBe(true);
    const html = body.parsed?.html ?? "";
    expect(html.startsWith('<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'')).toBe(true);
    expect(html).toContain("img-src data:;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("tracker.example.com");
    expect(html).toContain('href="https://newsletter.example.com/issues/42"');
    expect(JSON.stringify(body)).not.toContain("<script>");

    const allowed = (await detail(id, "?remote_images=allow")).parsed?.html ?? "";
    expect(allowed).toContain("img-src data: https:;");
    expect(allowed).toContain("https://tracker.example.com/pixel.gif");
    expect((await api(`/api/admin/mails/${id}?remote_images=yes`, { cookie })).status).toBe(400);
  });

  it("纯文本邮件不带 html 字段", async () => {
    const id = await insertMail({ address: "a@example.com", raw: fixture("verification-code.eml") });
    expect((await detail(id)).parsed?.html).toBeUndefined();
  });

  it("不存在的邮件 404；非法 id 400", async () => {
    expect((await api("/api/admin/mails/424242", { cookie })).status).toBe(404);
    expect((await api("/api/admin/mails/abc", { cookie })).status).toBe(400);
    expect((await api("/api/admin/mails/1?raw=yes", { cookie })).status).toBe(400);
  });
});

describe("GET /api/admin/mails/:id/attachments/:index", () => {
  it("响应头：attachment、octet-stream、nosniff、RFC 5987 文件名；内容完整", async () => {
    const id = await insertMail({ address: "a@example.com", raw: fixture("attachment.eml") });
    const res = await api(`/api/admin/mails/${id}/attachments/0`, { cookie });
    expect(res.status).toBe(200);
    // 邮件里声明的是 text/plain，但响应不信任它
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="__.txt"; filename*=UTF-8''%E6%8A%A5%E5%91%8A.txt`,
    );
    const text = new TextDecoder().decode(await res.arrayBuffer());
    expect(text).toContain("synthetic attachment content");
    expect(text).toContain("合成附件内容");
    expect(res.headers.get("Content-Length")).toBe(String(new TextEncoder().encode(text).length));
  });

  it("emoji 文件名：200，头部是合法的 RFC 5987（不会因代理对 500）", async () => {
    const id = await insertMail({ address: "a@example.com", raw: fixture("attachment-emoji.eml") });
    const res = await api(`/api/admin/mails/${id}/attachments/0`, { cookie });
    expect(res.status).toBe(200);
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toContain("filename*=UTF-8''%F0%9F%93%8Ereport%F0%9F%98%80.txt");
    expect(disposition).toMatch(/^attachment; filename="[\x20-\x7e]+"; /);
  });

  it("不存在的下标、没有附件的邮件、不存在的邮件：404", async () => {
    const withAttachment = await insertMail({ address: "a@example.com", raw: fixture("attachment.eml") });
    const without = await insertMail({ address: "a@example.com", raw: fixture("verification-code-spaced.eml") });
    expect((await api(`/api/admin/mails/${withAttachment}/attachments/1`, { cookie })).status).toBe(404);
    expect((await api(`/api/admin/mails/${without}/attachments/0`, { cookie })).status).toBe(404);
    expect((await api(`/api/admin/mails/424242/attachments/0`, { cookie })).status).toBe(404);
    expect((await api(`/api/admin/mails/${withAttachment}/attachments/-1`, { cookie })).status).toBe(400);
  });

  it("文件名里的引号、换行、分号不会注入头部", async () => {
    const raw = fixture("attachment.eml").replace(
      /name\*=UTF-8''%E6%8A%A5%E5%91%8A\.txt/g,
      "name*=UTF-8''a%22b%0D%0AX-Evil%3A%201%3B%27c.txt",
    );
    const id = await insertMail({ address: "a@example.com", raw });
    const res = await api(`/api/admin/mails/${id}/attachments/0`, { cookie });
    expect(res.status).toBe(200);
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition.startsWith("attachment; filename=\"")).toBe(true);
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(res.headers.get("X-Evil")).toBeNull();
    expect(disposition).toContain("filename*=UTF-8''a%22b%20X-Evil%3A%201%3B%27c.txt");
  });

  it("解析失败的邮件：422", async () => {
    const id = await insertMail({ address: "a@example.com", raw: fixture("malformed.eml") });
    const res = await api(`/api/admin/mails/${id}/attachments/0`, { cookie });
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe("mail_parse_failed");
  });
});

describe("MAIL_DB 不健康", () => {
  it("三个接口都返回 503 mail_db_unhealthy，且仍是 no-store", async () => {
    await setupMailDb({ omitColumns: ["raw"] });
    for (const path of ["/api/admin/mails", "/api/admin/mails/1", "/api/admin/mails/1/attachments/0"]) {
      const res = await api(path, { cookie });
      expect(res.status, path).toBe(503);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const body = (await res.json()) as ErrorBody;
      expect(body.error.code).toBe("mail_db_unhealthy");
      expect(body.error.message).toContain("raw");
    }
  });

  it("MAIL_DB 里没有 raw_mails 表：503", async () => {
    await setupMailDb({ rawMails: false });
    expect((await api("/api/admin/mails", { cookie })).status).toBe(503);
  });

  it("缺 to_address 列：列表仍可用，按 to_address 过滤 400", async () => {
    await setupMailDb({ omitColumns: ["to_address"] });
    const id = await insertMail({ address: "a@example.com", raw: "From: a@example.org\r\nSubject: s\r\n\r\nx" }, [
      "source", "address", "raw", "created_at", "message_id",
    ]);
    expect((await list()).items.map((item) => item.id)).toEqual([id]);
    expect((await api("/api/admin/mails?to_address=a@example.com", { cookie })).status).toBe(400);
  });
});
