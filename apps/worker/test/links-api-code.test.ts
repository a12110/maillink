import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { linkApiCodeResponseSchema, type LinkPreviewResponse, type LinkRevealResponse } from "@maillink/shared";
import { baseConfig, putMail } from "./access-helpers";
import { adminSession, api, resetApp } from "./helpers";
import { accessLogs, importMailboxes, linkRow, publicApi, tableCounts, visitorCookie } from "./link-helpers";
import { apiCode, apiCodeOk, apiError, codeMail, codeOnlyConfig, linkWith, plainMail } from "./api-code-helpers";

// API 取码 GET /api/s/:token/code：选邮件、状态、计次与网页共用额度。

let cookie: string;
let mailboxId: number;
const nowSec = () => Math.floor(Date.now() / 1000);
const deliveryCount = async () => (await tableCounts()).link_deliveries;

beforeEach(async () => {
  await resetApp();
  cookie = (await adminSession()).cookie;
  mailboxId = (await importMailboxes(cookie, ["box@example.com", "other@example.com"])).get("box@example.com") as number;
});

const link = (config = codeOnlyConfig(), extra = {}) => linkWith(cookie, mailboxId, config, extra);

describe("选邮件与响应", () => {
  it("auto：返回最新一封的验证码；发件人与收件地址按规则组打码；不含主题、正文、token；安全头；不发 Cookie", async () => {
    await codeMail("111111", 60);
    const newest = await codeMail("222222", 10);
    await codeMail("999999", 0, "other@example.com");
    const { id, token } = await link();
    const res = await apiCode(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.getSetCookie()).toEqual([]);
    const text = await res.text();
    const body = linkApiCodeResponseSchema.parse(JSON.parse(text));
    expect(body).toMatchObject({
      status: "ok",
      code: "222222",
      mail_id: newest,
      sender: { domain: "login.example.org" },
      partial: false,
      retry_after_sec: null,
      remaining: null,
    });
    expect(body.mailbox).not.toBe("box@example.com");
    expect(body.mailbox).toMatch(/\*/u);
    expect(body.received_at_iso).toBe(new Date((body.received_at ?? 0) * 1000).toISOString());
    expect(body.items).toHaveLength(1);
    for (const forbidden of ["Sign in", "verification code is", token, "subject", "snippet", "text"]) expect(text).not.toContain(forbidden);
    expect(await accessLogs(id)).toEqual([{ event: "api_code", reason: "ok", mail_id: newest }]);
  });

  it("首次调用等同开始取码：登记一台 API 设备（预览里显示 api）、写 first_access_at；之后不重复登记", async () => {
    await codeMail("111111");
    const { id, token } = await link();
    await apiCodeOk(token);
    await apiCodeOk(token);
    expect((await tableCounts()).link_visitors).toBe(1);
    expect((await linkRow(id)).first_access_at).not.toBeNull();
    const preview = await (await api(`/api/admin/links/${id}/preview`, { cookie })).json<LinkPreviewResponse>();
    expect(preview.visitors.map((visitor) => visitor.visitor)).toEqual(["api"]);
  });

  it("没有验证码：no_code，retry_after_sec 为轮询间隔；没有邮件同样", async () => {
    const { token } = await link(baseConfig(), { access: { poll_interval_sec: 30 } });
    expect(await apiCodeOk(token)).toMatchObject({ status: "no_code", code: null, items: [], retry_after_sec: 30, sender: null, mailbox: null });
    await plainMail();
    expect((await apiCodeOk(token)).status).toBe("no_code");
  });

  it("不看 present.extract：text 视图、extract 为空也返回验证码", async () => {
    await codeMail("123456");
    const { token } = await link(baseConfig({ present: { extract: [] } }));
    expect((await apiCodeOk(token)).code).toBe("123456");
  });

  it("meta_only：200 no_code + view_meta_only，不登记设备、不激活、不计次", async () => {
    await codeMail("123456");
    const { id, token } = await link(baseConfig({ present: { view: "meta_only", extract: [] } }), { access: { reveal: "click" } });
    const body = await apiCodeOk(token);
    expect(body).toMatchObject({ status: "no_code", reason: "view_meta_only", retry_after_sec: null, code: null, items: [] });
    expect(await tableCounts()).toMatchObject({ link_visitors: 0, link_deliveries: 0 });
    expect((await linkRow(id)).first_access_at).toBeNull();
    expect(await accessLogs(id)).toEqual([{ event: "api_code", reason: "view_meta_only", mail_id: null }]);
  });

  it("since：只看此后收到的邮件", async () => {
    await codeMail("111111", 600);
    const recent = await codeMail("222222", 5);
    const { token } = await link();
    expect((await apiCodeOk(token, { query: `?since=${nowSec() - 60}&limit=10` })).items.map((item) => item.mail_id)).toEqual([recent]);
    expect((await apiCodeOk(token, { query: `?since=${nowSec() + 60}` })).status).toBe("no_code");
  });

  it("limit：按新到旧返回多封；越界 400", async () => {
    const ids = [await codeMail("111111", 30), await codeMail("222222", 20), await codeMail("333333", 10)];
    const { token } = await link();
    const body = await apiCodeOk(token, { query: "?limit=2" });
    expect(body.items.map((item) => item.code)).toEqual(["333333", "222222"]);
    expect(body.code).toBe("333333");
    expect((await apiCodeOk(token, { query: "?limit=10" })).items.map((item) => item.mail_id)).toEqual([...ids].reverse());
    for (const query of ["?limit=0", "?limit=11", "?since=-1", "?limit=abc"]) {
      expect((await apiError(await apiCode(token, { query }))).code).toBe("validation_error");
    }
  });

  it("规则组屏蔽的高危邮件即使含码也不返回", async () => {
    const safe = await codeMail("111111", 60);
    await putMail({ address: "box@example.com", from: "noreply@login.example.org", subject: "Reset your password", text: "Your verification code is 654321 to reset your password.", ageSec: 0 });
    const { token } = await link();
    const body = await apiCodeOk(token, { query: "?limit=5" });
    expect(body.items.map((item) => item.mail_id)).toEqual([safe]);
    expect(JSON.stringify(body)).not.toContain("654321");
  });

  it("max_mails 是全局上限：最新 N 封里没有验证码就是 no_code", async () => {
    await codeMail("111111", 60);
    await plainMail(0);
    const { token } = await link(baseConfig({ limits: { max_mails: 1 } }));
    expect((await apiCodeOk(token)).status).toBe("no_code");
  });

  it("partial：更新的邮件还没解析完、尚未找到验证码 → pending（click 不计次）；重试后 ok", async () => {
    await codeMail("777777", 600);
    for (let index = 0; index < 12; index += 1) await plainMail(100 - index);
    const { token } = await link(baseConfig(), { access: { reveal: "click", poll_interval_sec: 15 } });
    const first = await apiCodeOk(token);
    expect(first).toMatchObject({ status: "pending", partial: true, retry_after_sec: 15, items: [], code: null });
    expect(await deliveryCount()).toBe(0);
    const second = await apiCodeOk(token);
    expect(second).toMatchObject({ status: "ok", code: "777777", partial: false });
    expect(await deliveryCount()).toBe(1);
  });
});

describe("click 计次", () => {
  async function webVisitor(token: string): Promise<string> {
    const res = await publicApi(`/api/s/${token}/start`, {}, { json: {} });
    expect(res.status).toBe(200);
    return visitorCookie(res);
  }

  it("与网页 reveal 共用 link_deliveries：网页取过的不再计；同一封重复调用不重复计；remaining 递减", async () => {
    const m1 = await codeMail("111111", 20);
    const m2 = await codeMail("222222", 10);
    const { id, token } = await link(codeOnlyConfig(), { access: { reveal: "click", max_deliveries_total: 5 } });
    const visitor = await webVisitor(token);
    expect((await (await publicApi(`/api/s/${token}/mails/${m1}/reveal`, { cookie: visitor }, { json: {} })).json<LinkRevealResponse>()).counted).toBe(true);
    const body = await apiCodeOk(token, { query: "?limit=2" });
    expect(body.items.map((item) => item.mail_id)).toEqual([m2, m1]);
    expect(body.remaining).toEqual({ total: 3, today: null });
    expect((await apiCodeOk(token, { query: "?limit=2" })).remaining).toEqual({ total: 3, today: null });
    expect(await deliveryCount()).toBe(2);
    const { results } = await env.APP_DB.prepare("SELECT mail_id, visitor_hash FROM link_deliveries WHERE mail_id = ?").bind(m2).all();
    expect(results).toEqual([{ mail_id: m2, visitor_hash: "api" }]);
    expect((await accessLogs(id)).filter((log) => log.event === "deliver").map((log) => log.mail_id)).toEqual([m1, m2]);
    // 网页那边这封也已解锁
    const list = await (await publicApi(`/api/s/${token}/mails`, { cookie: visitor })).json<{ items: Array<{ id: number; code?: string }> }>();
    expect(list.items.find((mail) => mail.id === m2)?.code).toBe("222222");
  });

  it("额度不够：按新到旧只返回额度允许的条数；总额度用尽后 410", async () => {
    await codeMail("111111", 30);
    await codeMail("222222", 20);
    await codeMail("333333", 10);
    const { id, token } = await link(codeOnlyConfig(), { access: { reveal: "click", max_deliveries_total: 2 } });
    const body = await apiCodeOk(token, { query: "?limit=3" });
    expect(body.items.map((item) => item.code)).toEqual(["333333", "222222"]);
    expect(body.remaining).toEqual({ total: 0, today: null });
    const gone = await apiError(await apiCode(token));
    expect(gone).toMatchObject({ status: 410, code: "link_unavailable" });
    expect((await accessLogs(id)).at(-1)).toMatchObject({ event: "api_code", reason: "total_limit" });
  });

  it("每日额度：最新一封已取过照常返回；来了未取过的新邮件 → 429 link_daily_limit + Retry-After", async () => {
    await codeMail("111111", 20);
    const { id, token } = await link(codeOnlyConfig(), { access: { reveal: "click", max_deliveries_per_day: 1 } });
    expect((await apiCodeOk(token)).remaining).toEqual({ total: null, today: 0 });
    expect((await apiCodeOk(token)).code).toBe("111111");
    await codeMail("222222", 0);
    const res = await apiCode(token);
    const error = await apiError(res);
    expect(error).toMatchObject({ status: 429, code: "link_daily_limit" });
    expect(typeof error.body["retry_after_at"]).toBe("number");
    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(86_000);
    expect(retryAfter).toBeLessThanOrEqual(86_400);
    expect((await accessLogs(id)).at(-1)).toMatchObject({ event: "api_code", reason: "daily_limit" });
    expect(await deliveryCount()).toBe(1);
  });

  it("auto 链接不计次", async () => {
    await codeMail("111111");
    const { token } = await link();
    await apiCodeOk(token);
    expect(await deliveryCount()).toBe(0);
  });

  it("并发 10 次同一请求：只计 1 次、只登记 1 台设备，全部 200", async () => {
    await codeMail("111111");
    const { id, token } = await link(codeOnlyConfig(), { access: { reveal: "click", max_deliveries_total: 5, max_devices: 1 } });
    const results = await Promise.all(Array.from({ length: 10 }, () => apiCode(token)));
    expect(results.map((res) => res.status)).toEqual(Array.from({ length: 10 }, () => 200));
    expect(await tableCounts()).toMatchObject({ link_deliveries: 1, link_visitors: 1 });
    expect((await accessLogs(id)).filter((log) => log.event === "deliver")).toHaveLength(1);
  });
});
