import { beforeEach, describe, expect, it } from "vitest";
import type { MyMailboxListResponse, PresentedMail, VisibleMailListResponse } from "@maillink/shared";
import { nowSec } from "../src/clock";
import { baseConfig, putMail } from "./access-helpers";
import { api, createSessionCookie, createUser, resetApp } from "./helpers";
import {
  allowSubjectConfig,
  deleteGrantRow,
  denySubjectConfig,
  grantRow,
  insertGrant,
  insertMailbox,
  insertRuleGroup,
  setGrantExpiry,
  setGrantRuleGroup,
  setMailboxStatus,
} from "./grants-helpers";

// 用户收件箱 /api/me/mailboxes 与 /api/me/mails：授权约束、越权 404、first_access 锚点。
// "全部"归并的分页在 me-mails-all.test.ts。

type ErrorBody = { error: { code: string; message: string } };

const A = "a@example.com";
const B = "b@example.com";

let aliceCookie = "";
let bobCookie = "";
let alice = 0;
let bob = 0;
let boxA = 0;
let boxB = 0;

beforeEach(async () => {
  await resetApp();
  alice = await createUser({ username: "alice" });
  bob = await createUser({ username: "bob" });
  aliceCookie = (await createSessionCookie(alice)).cookie;
  bobCookie = (await createSessionCookie(bob)).cookie;
  boxA = await insertMailbox(A);
  boxB = await insertMailbox(B);
});

const mails = async (cookie: string, query = "") => {
  const res = await api(`/api/me/mails${query}`, { cookie });
  return { status: res.status, res, body: (await res.json()) as VisibleMailListResponse & ErrorBody };
};
const detail = async (cookie: string, id: number, query = "") => {
  const res = await api(`/api/me/mails/${id}${query}`, { cookie });
  return { status: res.status, res, body: (await res.json()) as PresentedMail & ErrorBody };
};
const ids = (body: VisibleMailListResponse) => body.items.map((item) => item.id);

describe("GET /api/me/mailboxes", () => {
  it("未登录 401；只列自己有效的授权", async () => {
    expect((await api("/api/me/mailboxes")).status).toBe(401);
    expect((await api("/api/me/mails")).status).toBe(401);
    const mine = await insertGrant({ userId: alice, mailboxId: boxA });
    await insertGrant({ userId: bob, mailboxId: boxB });
    const res = await api("/api/me/mailboxes", { cookie: aliceCookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as MyMailboxListResponse;
    expect(body.items).toEqual([
      { id: mine, address: A, label: null, recipient: "full", view: "full", expires_at: null, available: true },
    ]);
  });

  it("过期、地址停用的授权不在列表；删除授权后消失", async () => {
    const disabled = await insertMailbox("off@example.com", "disabled");
    await insertGrant({ userId: alice, mailboxId: boxA, expiresAt: nowSec() - 1 });
    await insertGrant({ userId: alice, mailboxId: disabled });
    const live = await insertGrant({ userId: alice, mailboxId: boxB, expiresAt: nowSec() + 600 });
    const list = async () => ((await (await api("/api/me/mailboxes", { cookie: aliceCookie })).json()) as MyMailboxListResponse).items;
    expect((await list()).map((item) => item.id)).toEqual([live]);
    await api(`/api/me/mails?mailbox=${live}`, { cookie: aliceCookie });
    await deleteGrantRow(live);
    expect(await list()).toEqual([]);
  });

  it("recipient：masked 打码、hidden 不给地址与名称、full 给名称；view 随规则组", async () => {
    await insertMailbox("labeled@example.com");
    const masked = await insertRuleGroup("masked", baseConfig({ present: { recipient: "masked" } }));
    const hidden = await insertRuleGroup("hidden", baseConfig({ present: { recipient: "hidden", view: "meta_only", snippet: false, extract: [] } }));
    const g1 = await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: masked });
    const g2 = await insertGrant({ userId: alice, mailboxId: boxB, ruleGroupId: hidden });
    const body = (await (await api("/api/me/mailboxes", { cookie: aliceCookie })).json()) as MyMailboxListResponse;
    expect(body.items).toEqual([
      { id: g1, address: "***@example.com", label: null, recipient: "masked", view: "text", expires_at: null, available: true },
      { id: g2, address: null, label: null, recipient: "hidden", view: "meta_only", expires_at: null, available: true },
    ]);
    expect(JSON.stringify(body)).not.toContain(B);
  });

  it("规则组配置失效：available=false，不暴露地址", async () => {
    const broken = await insertRuleGroup("broken", { schema_version: 9 });
    const id = await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: broken });
    const body = (await (await api("/api/me/mailboxes", { cookie: aliceCookie })).json()) as MyMailboxListResponse;
    expect(body.items).toEqual([{ id, address: null, label: null, recipient: null, view: null, expires_at: null, available: false }]);
  });
});

describe("指定授权的邮件列表与详情", () => {
  it("只看到该授权地址的邮件；Cache-Control: no-store", async () => {
    const inA = await putMail({ address: A, subject: "in A" });
    await putMail({ address: B, subject: "in B" });
    const g = await insertGrant({ userId: alice, mailboxId: boxA });
    const { status, res, body } = await mails(aliceCookie, `?mailbox=${g}`);
    expect(status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(ids(body)).toEqual([inA]);
    const d = await detail(aliceCookie, inA, `?mailbox=${g}`);
    expect(d.status).toBe(200);
    expect(d.res.headers.get("Cache-Control")).toBe("no-store");
    expect(d.body).toMatchObject({ id: inA, subject: "in A" });
  });

  it("rule_group_id=null 完整访问（full 视图，带 html）", async () => {
    const id = await putMail({ address: A, subject: "full", html: "<p>hello <b>bold</b></p>" });
    await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: null });
    const d = await detail(aliceCookie, id);
    expect(d.status).toBe(200);
    expect(d.body.html).toContain("<b>bold</b>");
    expect(d.body.recipient).toBe(A);
  });

  it("规则组约束生效：黑名单屏蔽的邮件既不在列表也 404；白名单只放行命中的", async () => {
    const ok = await putMail({ address: A, subject: "welcome" });
    const spam = await putMail({ address: A, subject: "spam offer" });
    const denyGroup = await insertRuleGroup("deny", denySubjectConfig("spam"));
    const g = await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: denyGroup });
    expect(ids((await mails(aliceCookie, `?mailbox=${g}`)).body)).toEqual([ok]);
    expect((await detail(aliceCookie, spam)).status).toBe(404);
    expect((await detail(aliceCookie, spam, `?mailbox=${g}`)).status).toBe(404);

    const allowGroup = await insertRuleGroup("allow", allowSubjectConfig("offer"));
    await setGrantRuleGroup(g, allowGroup);
    await insertGrant({ userId: bob, mailboxId: boxA, ruleGroupId: allowGroup });
    expect(ids((await mails(bobCookie)).body)).toEqual([spam]);
    expect((await detail(bobCookie, ok)).status).toBe(404);
    expect((await detail(bobCookie, spam)).status).toBe(200);
  });

  it("code_only：列表有验证码，详情与附件 404", async () => {
    const id = await putMail({ address: A, subject: "Your verification code", text: "Your verification code is 482913" });
    const group = await insertRuleGroup(
      "code-only",
      baseConfig({ present: { view: "code_only", snippet: false, sender: "hidden", recipient: "hidden", attachments: "hidden" } }),
    );
    const g = await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: group });
    const list = await mails(aliceCookie, `?mailbox=${g}`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id, code: "482913" });
    expect(list.body.items[0]).not.toHaveProperty("subject");
    expect((await detail(aliceCookie, id)).status).toBe(404);
    expect((await api(`/api/me/mails/${id}/attachments/0`, { cookie: aliceCookie })).status).toBe(404);
  });

  it("附件：规则组允许下载时可取，响应头不信任类型；list 模式 404", async () => {
    const id = await putMail({ address: A, attachment: { name: "note.txt", content: "attached text" } });
    const downloadable = await insertRuleGroup("dl", baseConfig({ present: { attachments: "download" } }));
    const g = await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: downloadable });
    const ok = await api(`/api/me/mails/${id}/attachments/0?mailbox=${g}`, { cookie: aliceCookie });
    expect(ok.status).toBe(200);
    expect(new TextDecoder().decode(await ok.arrayBuffer())).toContain("attached text");
    expect(ok.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(ok.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    expect((await api(`/api/me/mails/${id}/attachments/5`, { cookie: aliceCookie })).status).toBe(404);

    await setGrantRuleGroup(g, null);
    const listOnly = await insertRuleGroup("list-only", baseConfig({ present: { attachments: "list" } }));
    await insertGrant({ userId: bob, mailboxId: boxA, ruleGroupId: listOnly });
    expect((await api(`/api/me/mails/${id}/attachments/0`, { cookie: bobCookie })).status).toBe(404);
  });

  it("参数校验：mailbox 非数字、cursor 与 after_id 同时给 → 400", async () => {
    expect((await mails(aliceCookie, "?mailbox=abc")).status).toBe(400);
    expect((await mails(aliceCookie, "?cursor=5&after_id=3")).status).toBe(400);
    expect((await mails(aliceCookie, "?cursor=0")).status).toBe(400);
    expect((await detail(aliceCookie, 1, "?mailbox=x")).status).toBe(400);
  });
});

describe("越权与不可见授权一律 404", () => {
  it("用户 A 用 B 的 grant_id、或任意邮件 id", async () => {
    const mineMail = await putMail({ address: A, subject: "alice mail" });
    const bobsMail = await putMail({ address: B, subject: "bob mail" });
    const unassigned = await putMail({ address: "nobody@example.com", subject: "no grant" });
    const gAlice = await insertGrant({ userId: alice, mailboxId: boxA });
    const gBob = await insertGrant({ userId: bob, mailboxId: boxB });

    expect((await mails(aliceCookie, `?mailbox=${gBob}`)).status).toBe(404);
    expect((await detail(aliceCookie, bobsMail, `?mailbox=${gBob}`)).status).toBe(404);
    expect((await detail(aliceCookie, mineMail, `?mailbox=${gBob}`)).status).toBe(404);
    expect((await detail(aliceCookie, bobsMail, `?mailbox=${gAlice}`)).status).toBe(404);
    expect((await detail(aliceCookie, bobsMail)).status).toBe(404);
    expect((await detail(aliceCookie, unassigned)).status).toBe(404);
    expect((await detail(aliceCookie, 999_999)).status).toBe(404);
    expect((await api(`/api/me/mails/${bobsMail}/attachments/0`, { cookie: aliceCookie })).status).toBe(404);
    expect((await detail(aliceCookie, mineMail)).status).toBe(200);
    // 响应不区分"没有这个授权"和"不是你的授权"
    const missing = await mails(aliceCookie, "?mailbox=99999");
    const foreign = await mails(aliceCookie, `?mailbox=${gBob}`);
    expect(missing.body).toEqual(foreign.body);
  });

  it("过期、被删除、地址停用：列表与详情都 404", async () => {
    const id = await putMail({ address: A, subject: "mail" });
    const expired = await insertGrant({ userId: alice, mailboxId: boxA, expiresAt: nowSec() + 600 });
    expect((await detail(aliceCookie, id)).status).toBe(200);

    await setGrantExpiry(expired, nowSec() - 1);
    expect((await mails(aliceCookie, `?mailbox=${expired}`)).status).toBe(404);
    expect((await detail(aliceCookie, id)).status).toBe(404);
    expect((await detail(aliceCookie, id, `?mailbox=${expired}`)).status).toBe(404);
    expect((await mails(aliceCookie)).body.items).toEqual([]);

    await setGrantExpiry(expired, null);
    expect((await detail(aliceCookie, id)).status).toBe(200);
    await setMailboxStatus(boxA, "disabled");
    expect((await mails(aliceCookie, `?mailbox=${expired}`)).status).toBe(404);
    expect((await detail(aliceCookie, id)).status).toBe(404);

    await setMailboxStatus(boxA, "active");
    expect((await detail(aliceCookie, id)).status).toBe(200);
    await deleteGrantRow(expired);
    expect((await mails(aliceCookie, `?mailbox=${expired}`)).status).toBe(404);
    expect((await detail(aliceCookie, id)).status).toBe(404);
  });

  it("授权的规则组配置失效：指定授权 503 rule_group_invalid（失败关闭），其余授权不受影响", async () => {
    const mine = await putMail({ address: A, subject: "ok" });
    await putMail({ address: B, subject: "hidden by invalid group" });
    const broken = await insertRuleGroup("broken", { schema_version: 9 });
    await insertGrant({ userId: alice, mailboxId: boxA });
    const bad = await insertGrant({ userId: alice, mailboxId: boxB, ruleGroupId: broken });
    const single = await mails(aliceCookie, `?mailbox=${bad}`);
    expect(single.status).toBe(503);
    expect(single.body.error.code).toBe("rule_group_unsupported_version");
    expect(ids((await mails(aliceCookie)).body)).toEqual([mine]);
  });
});

describe("授权的 first_access 锚点", () => {
  const firstAccessGroup = async () =>
    await insertRuleGroup("first", baseConfig({ time: { since: { type: "first_access", lookback_minutes: 0 } } }));

  it("第一次请求该授权的列表时写入，之后不再改写；详情不写", async () => {
    const group = await firstAccessGroup();
    const g = await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: group });
    const old = await putMail({ address: A, subject: "before access", ageSec: 3600 });
    await detail(aliceCookie, old, `?mailbox=${g}`);
    expect((await grantRow(g))?.first_access_at).toBeNull();

    const before = nowSec();
    expect(ids((await mails(aliceCookie, `?mailbox=${g}`)).body)).toEqual([]);
    const written = (await grantRow(g))?.first_access_at ?? 0;
    expect(written).toBeGreaterThanOrEqual(before);

    const fresh = await putMail({ address: A, subject: "after access" });
    expect(ids((await mails(aliceCookie, `?mailbox=${g}`)).body)).toEqual([fresh]);
    expect((await grantRow(g))?.first_access_at).toBe(written);
    expect((await detail(aliceCookie, old)).status).toBe(404);
    expect((await detail(aliceCookie, fresh)).status).toBe(200);
  });

  it("别人的列表请求不写我的授权；无效授权（过期）不写", async () => {
    const group = await firstAccessGroup();
    const g = await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: group });
    const expired = await insertGrant({ userId: alice, mailboxId: boxB, ruleGroupId: group, expiresAt: nowSec() - 5 });
    await mails(bobCookie, `?mailbox=${g}`);
    await mails(bobCookie);
    expect((await grantRow(g))?.first_access_at).toBeNull();
    await mails(aliceCookie);
    expect((await grantRow(g))?.first_access_at).not.toBeNull();
    expect((await grantRow(expired))?.first_access_at).toBeNull();
  });

  it("subject_created：授权创建之前的邮件看不到（授权创建时间是锚点）", async () => {
    const group = await insertRuleGroup("created", baseConfig({ time: { since: { type: "subject_created" } } }));
    const before = await putMail({ address: A, subject: "from previous owner", ageSec: 3600 });
    const g = await insertGrant({ userId: alice, mailboxId: boxA, ruleGroupId: group, createdAt: nowSec() - 60 });
    const after = await putMail({ address: A, subject: "after grant", ageSec: 10 });
    expect(ids((await mails(aliceCookie, `?mailbox=${g}`)).body)).toEqual([after]);
    expect((await detail(aliceCookie, before)).status).toBe(404);
  });
});
