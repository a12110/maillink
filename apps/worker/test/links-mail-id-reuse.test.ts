import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { LinkPreviewResponse, LinkRevealResponse, PresentedMail, ShareLinkCreate, VisibleMailListResponse } from "@maillink/shared";
import { baseConfig, buildMail, putMail } from "./access-helpers";
import { adminSession, api, resetApp } from "./helpers";
import { createLink, createRuleGroup, importMailboxes, publicApi, tableCounts, visitorCookie, type ErrorBody } from "./link-helpers";
import { d1Time, insertMail } from "./mail-helpers";

// FIN-A：temp_email 删除邮件后新邮件复用同一个 id。取码记录按邮件身份（message_id、received_at、recipient，
// 与 mail_index 判定 id 复用同一口径）核对：复用 id 的新邮件要重新点取并计次，旧记录不能替它放行。

let cookie: string;
let boxId: number;
const ADDRESS = "box@example.com";
const nowSec = () => Math.floor(Date.now() / 1000);

beforeEach(async () => {
  await resetApp();
  cookie = (await adminSession()).cookie;
  boxId = (await importMailboxes(cookie, [ADDRESS])).get(ADDRESS) as number;
});

async function clickLink(access: ShareLinkCreate["access"]): Promise<{ id: number; token: string; visitor: string }> {
  const groupId = await createRuleGroup(cookie, baseConfig());
  const { id, token } = await createLink(cookie, { mailbox_ids: [boxId], rule_group_id: groupId, access: { reveal: "click", ...access } });
  const res = await publicApi(`/api/s/${token}/start`, {}, { json: {} });
  if (res.status !== 200) throw new Error(`start 失败 ${res.status}: ${await res.text()}`);
  return { id, token, visitor: visitorCookie(res) };
}

const codeMail = (code: string, ageSec = 60) => putMail({ address: ADDRESS, subject: "Sign in", text: `Your verification code is ${code}`, ageSec });
// baseConfig 是 text 视图：验证码出现在 snippet 里，锁定的邮件没有 snippet
const listItem = async (token: string, visitor: string, mailId: number) =>
  (await (await publicApi(`/api/s/${token}/mails`, { cookie: visitor })).json<VisibleMailListResponse>()).items.find((mail) => mail.id === mailId);
const reveal = (token: string, visitor: string, mailId: number) => publicApi(`/api/s/${token}/mails/${mailId}/reveal`, { cookie: visitor }, { json: {} });
const detail = (token: string, visitor: string, mailId: number) => publicApi(`/api/s/${token}/mails/${mailId}`, { cookie: visitor });

type Reuse = { label: string; messageId: (old: string) => string };
const REUSES: Reuse[] = [
  { label: "message_id 与收件时间都变了", messageId: () => "<reused-new@example.org>" },
  { label: "只有收件时间变了（message_id 相同）", messageId: (old) => old },
];

/** 模拟 temp_email 删掉这封后，新邮件拿到同一个 id（收件时间晚 30 秒） */
async function reuseMailId(mailId: number, code: string, reuse: Reuse): Promise<void> {
  const old = await env.MAIL_DB.prepare("SELECT message_id FROM raw_mails WHERE id = ?").bind(mailId).first<{ message_id: string }>();
  await env.MAIL_DB.prepare("DELETE FROM raw_mails WHERE id = ?").bind(mailId).run();
  await insertMail({
    id: mailId,
    message_id: reuse.messageId(old?.message_id ?? ""),
    address: ADDRESS,
    raw: buildMail({ to: ADDRESS, subject: "Sign in again", text: `Your verification code is ${code}` }),
    created_at: d1Time(nowSec() - 30),
  });
}

describe("取码记录与邮件 id 复用", () => {
  it.each(REUSES)("复用 id 的新邮件（$label）：列表锁定、详情 404，重新 reveal 计一次后才显示", async (reuse) => {
    const mailId = await codeMail("111111");
    const { token, visitor } = await clickLink({ max_deliveries_total: 5 });
    expect((await (await reveal(token, visitor, mailId)).json<LinkRevealResponse>()).counted).toBe(true);
    expect((await listItem(token, visitor, mailId))?.snippet).toContain("111111");

    await reuseMailId(mailId, "222222", reuse);
    const locked = await listItem(token, visitor, mailId);
    expect(locked?.locked).toBe(true);
    expect(locked?.snippet).toBeUndefined();
    expect((await detail(token, visitor, mailId)).status).toBe(404);
    expect((await publicApi(`/api/s/${token}/mails/${mailId}/attachments/0`, { cookie: visitor })).status).toBe(404);

    const second = await (await reveal(token, visitor, mailId)).json<LinkRevealResponse>();
    expect(second).toMatchObject({ counted: true, mail: { id: mailId }, deliveries: { total_used: 2 } });
    expect(second.mail.snippet).toContain("222222");
    expect((await tableCounts()).link_deliveries).toBe(2);
    expect((await listItem(token, visitor, mailId))?.snippet).toContain("222222");
    const shown = await detail(token, visitor, mailId);
    expect(shown.status).toBe(200);
    expect((await shown.json<PresentedMail>()).text).toContain("222222");
  });

  it("复用 id 的新邮件受总次数约束：旧记录用掉的次数不能让它免费显示", async () => {
    const mailId = await codeMail("111111");
    const { token, visitor } = await clickLink({ max_deliveries_total: 1 });
    expect((await reveal(token, visitor, mailId)).status).toBe(200);
    await reuseMailId(mailId, "222222", REUSES[0] as Reuse);
    const blocked = await reveal(token, visitor, mailId);
    expect(blocked.status).toBe(410);
    expect((await blocked.json<ErrorBody>()).error.code).toBe("link_unavailable");
    expect((await tableCounts()).link_deliveries).toBe(1);
  });

  it("原邮件仍在：行为不变（重复 reveal 不计次，列表与详情照常显示，管理员预览标记已交付）", async () => {
    const mailId = await codeMail("111111");
    const { id, token, visitor } = await clickLink({ max_deliveries_total: 2 });
    expect((await (await reveal(token, visitor, mailId)).json<LinkRevealResponse>()).counted).toBe(true);
    const again = await (await reveal(token, visitor, mailId)).json<LinkRevealResponse>();
    expect(again).toMatchObject({ counted: false, deliveries: { total_used: 1 } });
    expect(again.mail.snippet).toContain("111111");
    expect((await listItem(token, visitor, mailId))?.snippet).toContain("111111");
    expect((await detail(token, visitor, mailId)).status).toBe(200);
    const preview = await (await api(`/api/admin/links/${id}/preview`, { cookie })).json<LinkPreviewResponse>();
    expect(preview.items.find((item) => item.mail_id === mailId)?.delivered).toBe(true);

    await reuseMailId(mailId, "222222", REUSES[0] as Reuse);
    const reused = await (await api(`/api/admin/links/${id}/preview`, { cookie })).json<LinkPreviewResponse>();
    expect(reused.items.find((item) => item.mail_id === mailId)?.delivered).toBe(false);
  });

  it("0010 之前的旧记录（身份列为 NULL）按不一致处理：不放行，但仍计入次数", async () => {
    const mailId = await codeMail("111111");
    const { id, token, visitor } = await clickLink({ max_deliveries_total: 5 });
    await env.APP_DB.prepare("INSERT INTO link_deliveries (link_id, mail_id, visitor_hash, delivered_at) VALUES (?, ?, 'legacy', ?)")
      .bind(id, mailId, nowSec())
      .run();
    expect((await listItem(token, visitor, mailId))?.locked).toBe(true);
    expect((await detail(token, visitor, mailId)).status).toBe(404);
    const revealed = await (await reveal(token, visitor, mailId)).json<LinkRevealResponse>();
    expect(revealed).toMatchObject({ counted: true, deliveries: { total_used: 2 } });
    expect(revealed.mail.snippet).toContain("111111");
  });
});
