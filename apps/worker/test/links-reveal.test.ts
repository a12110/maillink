import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  builtinRuleGroupTemplates,
  type LinkPreviewResponse,
  type LinkPublicStatus,
  type LinkRevealResponse,
  type PresentedMail,
  type RuleGroupConfigInput,
  type ShareLinkCreate,
  type ShareLinkRotateResponse,
  type VisibleMailListResponse,
} from "@maillink/shared";
import { baseConfig, putMail } from "./access-helpers";
import { adminSession, api, auditRows, resetApp } from "./helpers";
import { accessLogs, createLink, createRuleGroup, importMailboxes, linkRow, publicApi, tableCounts, visitorCookie, type ErrorBody } from "./link-helpers";

let cookie: string;
let boxes: Map<string, number>;
const nowSec = () => Math.floor(Date.now() / 1000);
const box = (address: string) => boxes.get(address) as number;

function codeOnlyConfig(): RuleGroupConfigInput {
  const template = builtinRuleGroupTemplates().find((item) => item.key === "code_only");
  if (!template) throw new Error("缺少仅验证码模板");
  return { ...template.config, time: { since: { type: "none" } } };
}

beforeEach(async () => {
  await resetApp();
  cookie = (await adminSession()).cookie;
  boxes = await importMailboxes(cookie, ["box@example.com", "new@example.com", "other@example.com"]);
});

async function activeLink(config: RuleGroupConfigInput, extra: Partial<ShareLinkCreate> = {}): Promise<{ id: number; token: string; visitor: string }> {
  const groupId = await createRuleGroup(cookie, config);
  const { id, token } = await createLink(cookie, { mailbox_ids: [box("box@example.com")], rule_group_id: groupId, ...extra });
  const res = await publicApi(`/api/s/${token}/start`, {}, { json: {} });
  if (res.status !== 200) throw new Error(`start 失败 ${res.status}: ${await res.text()}`);
  return { id, token, visitor: visitorCookie(res) };
}

const codeMail = (code: string, ageSec = 0, address = "box@example.com") =>
  putMail({ address, from: "noreply@login.example.org", subject: "Sign in", text: `Your verification code is ${code}`, ageSec });
const listMails = async (token: string, visitor: string, query = "") =>
  (await publicApi(`/api/s/${token}/mails${query}`, { cookie: visitor })).json<VisibleMailListResponse>();
const reveal = (token: string, visitor: string, mailId: number) => publicApi(`/api/s/${token}/mails/${mailId}/reveal`, { cookie: visitor }, { json: {} });
const deliveryCount = async () => (await tableCounts()).link_deliveries;

describe("click 取码", () => {
  const clickAccess = { reveal: "click" as const, max_devices: 1, max_deliveries_total: 2 };

  it("未交付的邮件 locked；reveal 后显示验证码；同一封重复 reveal 不重复计；写 deliver 日志", async () => {
    const m1 = await codeMail("111111");
    const m2 = await codeMail("222222");
    const { id, token, visitor } = await activeLink(codeOnlyConfig(), { access: clickAccess });
    const list = await listMails(token, visitor);
    expect(list.items.map((mail) => mail.locked)).toEqual([true, true]);
    expect(list.items.every((mail) => mail.code === undefined)).toBe(true);
    const first = await (await reveal(token, visitor, m1)).json<LinkRevealResponse>();
    expect(first).toMatchObject({ counted: true, mail: { id: m1, code: "111111" }, deliveries: { total_used: 1, total_remaining: 1 } });
    const again = await (await reveal(token, visitor, m1)).json<LinkRevealResponse>();
    expect(again).toMatchObject({ counted: false, mail: { code: "111111" }, deliveries: { total_used: 1 } });
    expect(await deliveryCount()).toBe(1);
    const after = await listMails(token, visitor);
    expect(after.items.find((mail) => mail.id === m1)?.code).toBe("111111");
    expect(after.items.find((mail) => mail.id === m2)?.locked).toBe(true);
    expect((await accessLogs(id)).map((log) => [log.event, log.mail_id])).toEqual([
      ["start", null],
      ["deliver", m1],
    ]);
    expect((await linkRow(id)).last_access_at).not.toBeNull();
  });

  it("总次数用尽：之后整个链接对外\"已失效\"，再 reveal 记 total_limit", async () => {
    const [m1, m2, m3] = [await codeMail("111111"), await codeMail("222222"), await codeMail("333333")];
    const { id, token, visitor } = await activeLink(codeOnlyConfig(), { access: clickAccess });
    expect((await reveal(token, visitor, m1)).status).toBe(200);
    const second = await (await reveal(token, visitor, m2)).json<LinkRevealResponse>();
    expect(second.deliveries).toMatchObject({ total_used: 2, total_remaining: 0 });
    const third = await reveal(token, visitor, m3);
    expect(third.status).toBe(410);
    expect((await third.json<ErrorBody>()).error.code).toBe("link_unavailable");
    expect((await publicApi(`/api/s/${token}/mails`, { cookie: visitor })).status).toBe(410);
    expect((await accessLogs(id)).at(-1)).toMatchObject({ event: "denied", reason: "total_limit" });
  });

  it("每日上限：滚动 24 小时；用尽返回 429 与大约恢复时间（最早一次 + 24h），状态 daily_limit；窗口滚过后恢复", async () => {
    const [m1, m2] = [await codeMail("111111"), await codeMail("222222")];
    const { id, token, visitor } = await activeLink(codeOnlyConfig(), { access: { reveal: "click", max_deliveries_per_day: 1 } });
    expect((await reveal(token, visitor, m1)).status).toBe(200);
    const deliveredAt = (await env.APP_DB.prepare("SELECT delivered_at FROM link_deliveries").first<{ delivered_at: number }>())?.delivered_at ?? 0;
    const blocked = await reveal(token, visitor, m2);
    expect(blocked.status).toBe(429);
    expect((await blocked.json<ErrorBody>()).error).toMatchObject({ code: "link_daily_limit", retry_after_at: deliveredAt + 86400 });
    expect((await accessLogs(id)).at(-1)).toMatchObject({ reason: "daily_limit" });
    const status = await (await publicApi(`/api/s/${token}`, { cookie: visitor })).json<LinkPublicStatus>();
    expect(status).toMatchObject({ state: "daily_limit", retry_after_at: deliveredAt + 86400 });
    expect((await reveal(token, visitor, m1)).status).toBe(200);
    await env.APP_DB.prepare("UPDATE link_deliveries SET delivered_at = ?").bind(nowSec() - 86401).run();
    expect((await reveal(token, visitor, m2)).status).toBe(200);
  });

  it("并发 reveal 不突破上限（总数与每日）", async () => {
    const mails = [await codeMail("111111"), await codeMail("222222"), await codeMail("333333")];
    const total = await activeLink(codeOnlyConfig(), { access: { reveal: "click", max_deliveries_total: 1 } });
    const results = await Promise.all(mails.map((mailId) => reveal(total.token, total.visitor, mailId)));
    expect(results.filter((res) => res.status === 200)).toHaveLength(1);
    expect(await deliveryCount()).toBe(1);
    const daily = await activeLink(codeOnlyConfig(), { access: { reveal: "click", max_deliveries_per_day: 2 } });
    const dailyResults = await Promise.all(mails.map((mailId) => reveal(daily.token, daily.visitor, mailId)));
    expect(dailyResults.filter((res) => res.status === 200)).toHaveLength(2);
    expect(await deliveryCount()).toBe(3);
  });

  it("作用域外的邮件 reveal 404 且不计次；auto 模式 reveal 409", async () => {
    const outside = await codeMail("999999", 0, "other@example.com");
    const { token, visitor } = await activeLink(codeOnlyConfig(), { access: clickAccess });
    expect((await reveal(token, visitor, outside)).status).toBe(404);
    expect((await reveal(token, visitor, 987654)).status).toBe(404);
    expect(await deliveryCount()).toBe(0);
    const auto = await activeLink(codeOnlyConfig());
    const res = await reveal(auto.token, auto.visitor, outside);
    expect(res.status).toBe(409);
    expect((await res.json<ErrorBody>()).error.code).toBe("link_reveal_not_applicable");
  });

  it("详情：click 模式未交付 404，交付后可看；code_only 视图交付后仍 404", async () => {
    const mailId = await codeMail("123456");
    const text = await activeLink(baseConfig(), { access: { reveal: "click" } });
    expect((await publicApi(`/api/s/${text.token}/mails/${mailId}`, { cookie: text.visitor })).status).toBe(404);
    await reveal(text.token, text.visitor, mailId);
    const detail = await publicApi(`/api/s/${text.token}/mails/${mailId}`, { cookie: text.visitor });
    expect(detail.status).toBe(200);
    expect((await detail.json<PresentedMail>()).text).toContain("123456");
    const code = await activeLink(codeOnlyConfig(), { access: { reveal: "click" } });
    await reveal(code.token, code.visitor, mailId);
    expect((await publicApi(`/api/s/${code.token}/mails/${mailId}`, { cookie: code.visitor })).status).toBe(404);
  });
});

describe("auto 模式、max_mails、partial、附件", () => {
  it("max_mails：只给最新 N 封，没有下一页", async () => {
    for (const code of ["111111", "222222", "333333"]) await codeMail(code);
    const { token, visitor } = await activeLink(baseConfig({ limits: { max_mails: 2 } }));
    const list = await listMails(token, visitor);
    expect(list.items).toHaveLength(2);
    expect(list.next_cursor).toBeNull();
    expect(list.items.every((mail) => mail.locked === undefined)).toBe(true);
  });

  it("partial 透传：一次解析不完时 partial=true，再取补齐；next_after_id 不越过未就绪邮件", async () => {
    for (let index = 0; index < 12; index += 1) await codeMail(String(100000 + index));
    const { token, visitor } = await activeLink(baseConfig());
    const first = await listMails(token, visitor);
    expect(first.partial).toBe(true);
    expect(first.next_after_id).toBeNull();
    const second = await listMails(token, visitor);
    expect(second.partial).toBe(false);
    expect(second.items).toHaveLength(12);
  });

  it("附件下载：attachment + nosniff，写 download 日志", async () => {
    const mailId = await putMail({ address: "box@example.com", subject: "file", attachment: { name: "a.txt", content: "hello" } });
    const { id, token, visitor } = await activeLink(baseConfig({ present: { attachments: "download" } }));
    const res = await publicApi(`/api/s/${token}/mails/${mailId}/attachments/0`, { cookie: visitor });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("hello");
    expect((await accessLogs(id)).at(-1)).toMatchObject({ event: "download", mail_id: mailId });
  });
});

describe("rotate、换绑、预览", () => {
  it("rotate 后旧 token 立即 404，新 token 可用，已登记的设备保留", async () => {
    const { id, token, visitor } = await activeLink(baseConfig());
    const res = await api(`/api/admin/links/${id}/rotate`, { cookie, json: {} });
    const rotated = await res.json<ShareLinkRotateResponse>();
    expect(rotated.token).not.toBe(token);
    expect((await publicApi(`/api/s/${token}`)).status).toBe(404);
    expect((await publicApi(`/api/s/${rotated.token}/mails`, { cookie: visitor })).status).toBe(200);
    expect(await auditRows("link.token_rotate")).toHaveLength(1);
  });

  it("换绑并重置起始时间：看不到新地址上换绑之前的邮件；重置设备后要重新开始取码", async () => {
    const before = await codeMail("111111", 120, "new@example.com");
    const { id, token, visitor } = await activeLink(baseConfig());
    const res = await api(`/api/admin/links/${id}/rebind`, {
      cookie,
      json: { mailbox_ids: [box("new@example.com")], reset_anchor: true, reset_devices: false },
    });
    expect(res.status).toBe(200);
    const after = await codeMail("222222", 0, "new@example.com");
    const ids = (await listMails(token, visitor)).items.map((mail) => mail.id);
    expect(ids).toEqual([after]);
    expect(ids).not.toContain(before);
    expect(await auditRows("link.rebind")).toHaveLength(1);
    await api(`/api/admin/links/${id}/reset`, { cookie, json: { reset_devices: true } });
    expect((await publicApi(`/api/s/${token}/mails`, { cookie: visitor })).status).toBe(401);
    expect(await auditRows("link.reset")).toHaveLength(1);
  });

  it("管理员预览：逐封 trace 与原因；不登记设备、不计次、不写 first_access_at、不写日志与审计", async () => {
    const visible = await codeMail("111111");
    const hidden = await putMail({ address: "box@example.com", subject: "Newsletter", text: "no code here" });
    const groupId = await createRuleGroup(cookie, codeOnlyConfig());
    const { id } = await createLink(cookie, { mailbox_ids: [box("box@example.com")], rule_group_id: groupId, access: { reveal: "click" } });
    const before = await tableCounts();
    const res = await api(`/api/admin/links/${id}/preview`, { cookie });
    expect(res.status).toBe(200);
    const body = await res.json<LinkPreviewResponse>();
    expect(body.items.find((item) => item.mail_id === visible)).toMatchObject({ visible: true, delivered: false, preview: { code: "111111" } });
    expect(body.items.find((item) => item.mail_id === hidden)).toMatchObject({ visible: false, reason_code: "no_allow_match" });
    expect(await tableCounts()).toEqual(before);
    const row = await linkRow(id);
    expect(row.first_access_at).toBeNull();
    expect(row.last_access_at).toBeNull();
  });
});
