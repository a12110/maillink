import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  compilePolicy,
  compileStoredPolicy,
  getVisibleAttachment,
  getVisibleMailDetail,
  grantPolicy,
  listVisibleMails,
  type AccessScope,
} from "../src/access";
import { nowSec } from "../src/clock";
import { MAX_PARSE_PER_REQUEST, SCAN_CAP_PER_REQUEST } from "../src/constants";
import { getOrBuild } from "../src/mail-index";
import { listCandidates } from "../src/mail-source";
import { buildLargeMail, LARGE_MAIL_TAIL_MARKER } from "./fixtures/build-large-mail";
import { baseConfig, buildMail, mailIndexIds, putMail, scopeOf } from "./access-helpers";
import { resetApp } from "./helpers";
import { d1Time, fixture, insertMail } from "./mail-helpers";

// 取件流水线（02 §5）：列表的下推与分流、详情与附件每次重走流水线（越权一律 404）、失败关闭。

beforeEach(async () => {
  await resetApp();
});

const A = "alice@example.com";
const B = "bob@example.com";

const list = (scope: AccessScope, options: { cursor?: string; afterId?: number } = {}) =>
  listVisibleMails(env, scope, { ...options, now: nowSec() });
const detail = (scope: AccessScope, id: number, remoteImages?: "block" | "allow") =>
  getVisibleMailDetail(env, scope, id, { now: nowSec(), remoteImages });
const expect404 = async (promise: Promise<unknown>) => {
  await expect(promise).rejects.toMatchObject({ status: 404, code: "not_found" });
};

const denySubject = (value: string) =>
  baseConfig({
    filter: {
      mode: "blacklist",
      rules: [{ id: "d", name: "屏蔽", enabled: true, effect: "deny", when: { field: "subject", op: "contains", value } }],
    },
  });

describe("地址归属与时间下界", () => {
  it("只列出作用域内地址的邮件；别的地址的 id 在详情里 404", async () => {
    const mine = await putMail({ address: A, subject: "mine" });
    const other = await putMail({ address: B, subject: "other" });
    const scope = scopeOf([A]);
    const page = await list(scope);
    expect(page.items.map((item) => item.id)).toEqual([mine]);
    expect((await detail(scope, mine)).subject).toBe("mine");
    await expect404(detail(scope, other));
    await expect404(detail(scope, 999_999));
  });

  it("导入时的大小写写法与全小写写法都匹配；to_address 优先于 address", async () => {
    const upper = await insertMail({ address: "Alice@example.com", raw: buildMail({ to: "Alice@example.com" }) });
    const forwarded = await insertMail({ address: "relay@example.net", to_address: "alice@example.com", raw: buildMail({}) });
    const page = await list(scopeOf(["Alice@Example.COM"]));
    expect(page.items.map((item) => item.id).sort()).toEqual([upper, forwarded].sort());
  });

  it("时间下界下推进 SQL：窗口外的邮件不进候选（mail_index 没有它），详情 404", async () => {
    const old = await putMail({ address: A, ageSec: 3600 });
    const fresh = await putMail({ address: A, ageSec: 60 });
    const scope = scopeOf([A], baseConfig({ time: { window_minutes: 10, since: { type: "none" } } }));
    expect((await list(scope)).items.map((item) => item.id)).toEqual([fresh]);
    expect(await mailIndexIds()).toEqual([fresh]);
    await expect404(detail(scope, old));
  });

  it("subject_created：早于链接创建时间的邮件不可见", async () => {
    const before = await putMail({ address: A, ageSec: 600 });
    const after = await putMail({ address: A, ageSec: 10 });
    const scope = scopeOf([A], baseConfig({ time: { since: { type: "subject_created" } } }), nowSec() - 300);
    expect((await list(scope)).items.map((item) => item.id)).toEqual([after]);
    await expect404(detail(scope, before));
  });
});

describe("状态分流", () => {
  it("解析失败的邮件不可见（列表与详情）", async () => {
    const bad = await insertMail({ address: A, raw: fixture("malformed.eml") });
    const good = await putMail({ address: A });
    const scope = scopeOf([A]);
    expect((await list(scope)).items.map((item) => item.id)).toEqual([good]);
    await expect404(detail(scope, bad));
  });

  it("pending 计入 partial：翻页游标停在未就绪邮件上，首页不给轮询起点", async () => {
    const ids: number[] = [];
    for (let i = 0; i < MAX_PARSE_PER_REQUEST + 3; i += 1) ids.push(await putMail({ address: A, subject: `m${i}` }));
    const page = await list(scopeOf([A]));
    expect(page.partial).toBe(true);
    expect(page.items).toHaveLength(MAX_PARSE_PER_REQUEST);
    const firstPending = ids[2] as number;
    expect(page.next_cursor).toBe(String(firstPending + 1));
    expect(page.next_after_id).toBeNull();
    // 再取一次，剩下的就绪
    const again = await list(scopeOf([A]));
    expect(again.partial).toBe(false);
    expect(again.items).toHaveLength(ids.length);
    expect(again.next_after_id).toBe(ids.at(-1));
  });

  it("增量轮询遇到 pending：next_after_id 不越过未就绪的邮件", async () => {
    const ids: number[] = [];
    for (let i = 0; i < MAX_PARSE_PER_REQUEST + 3; i += 1) ids.push(await putMail({ address: A }));
    const poll = await list(scopeOf([A]), { afterId: 0 });
    expect(poll.partial).toBe(true);
    const lastReady = ids[MAX_PARSE_PER_REQUEST - 1] as number;
    expect(poll.next_after_id).toBe(lastReady);
    expect(poll.items.map((item) => item.id)).toEqual(ids.slice(0, MAX_PARSE_PER_REQUEST).toReversed());
    const next = await list(scopeOf([A]), { afterId: poll.next_after_id ?? 0 });
    expect(next.partial).toBe(false);
    expect(next.items.map((item) => item.id)).toEqual(ids.slice(MAX_PARSE_PER_REQUEST).toReversed());
    expect(next.next_after_id).toBe(ids.at(-1));
  });
});

describe("扫描上限与 max_mails", () => {
  it("SCAN_CAP 截断：一次最多扫描 SCAN_CAP_PER_REQUEST 封，游标接着扫", async () => {
    const total = SCAN_CAP_PER_REQUEST + 5;
    const raw = buildMail({ subject: "nothing matches" });
    const statements = Array.from({ length: total }, () =>
      env.MAIL_DB.prepare("INSERT INTO raw_mails (address, raw, created_at) VALUES (?, ?, ?)").bind(A, raw, d1Time(nowSec())),
    );
    await env.MAIL_DB.batch(statements);
    // 预热索引，排除 pending 的干扰
    await getOrBuild(env, await listCandidates(env.MAIL_DB, { addresses: [A], limit: total }), { maxParse: total });
    const whitelist = baseConfig({
      filter: {
        mode: "whitelist",
        rules: [{ id: "a", name: "放行", enabled: true, effect: "allow", when: { field: "subject", op: "contains", value: "zzz" } }],
      },
    });
    const first = await list(scopeOf([A], whitelist));
    expect(first.items).toEqual([]);
    expect(first.partial).toBe(false);
    expect(first.next_cursor).not.toBeNull();
    const maxId = (await env.MAIL_DB.prepare("SELECT MAX(id) AS id FROM raw_mails").first<{ id: number }>())?.id ?? 0;
    expect(Number(first.next_cursor)).toBe(maxId - SCAN_CAP_PER_REQUEST + 1);
    const second = await list(scopeOf([A], whitelist), { cursor: first.next_cursor ?? "" });
    expect(second.items).toEqual([]);
    expect(second.next_cursor).toBeNull();
  });

  it("翻页跟着 next_cursor 继续取，不漏不重", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 45; i += 1) ids.push(await putMail({ address: A, subject: `m${i}`, ageSec: 100 - i }));
    await getOrBuild(env, await listCandidates(env.MAIL_DB, { addresses: [A], limit: 100 }), { maxParse: 100 });
    const seen: number[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await list(scopeOf([A]), cursor === undefined ? {} : { cursor });
      expect(result.partial).toBe(false);
      seen.push(...result.items.map((item) => item.id));
      if (result.next_cursor === null) break;
      cursor = result.next_cursor;
    }
    expect(seen).toEqual(ids.toReversed());
  });

  it("max_mails：从 after_id=0 起轮询拿不到最新 N 封以外的邮件", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(await putMail({ address: A, subject: `m${i}`, ageSec: 60 - i }));
    const scope = scopeOf([A], baseConfig({ limits: { max_mails: 2 } }));
    const newest = [ids[5], ids[4]];
    expect((await list(scope)).items.map((item) => item.id)).toEqual(newest);
    const fromZero = await list(scope, { afterId: 0 });
    expect(fromZero.items.map((item) => item.id)).toEqual(newest);
    expect(fromZero.next_cursor).toBeNull();
    expect(fromZero.next_after_id).toBe(ids[5]);
    expect((await list(scope, { afterId: ids[4] as number })).items.map((item) => item.id)).toEqual([ids[5]]);
    expect((await list(scope, { afterId: ids[5] as number })).items).toEqual([]);
  });

  it("max_mails：超出最新 N 封的邮件详情 404，N 封内的可见", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(await putMail({ address: A, subject: `m${i}`, ageSec: 60 - i }));
    const scope = scopeOf([A], baseConfig({ limits: { max_mails: 2 } }));
    expect((await detail(scope, ids[5] as number)).id).toBe(ids[5]);
    expect((await detail(scope, ids[4] as number)).id).toBe(ids[4]);
    for (const id of ids.slice(0, 4)) await expect404(detail(scope, id));
  });

  it("max_mails：只保留最新的 N 封，没有更多分页；更旧的可见邮件详情也 404", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 4; i += 1) ids.push(await putMail({ address: A, subject: `m${i}`, ageSec: 40 - i }));
    const scope = scopeOf([A], baseConfig({ limits: { max_mails: 2 } }));
    const page = await list(scope);
    expect(page.items.map((item) => item.id)).toEqual([ids[3], ids[2]]);
    expect(page.next_cursor).toBeNull();
    expect((await list(scope, { cursor: String(ids[2]) })).items).toEqual([]);
    expect((await detail(scope, ids[3] as number)).id).toBe(ids[3]);
    await expect404(detail(scope, ids[1] as number));
  });
});

describe("失败关闭", () => {
  it("规则组不合 schema、版本不认识、JSON 损坏：抛明确错误码，整个作用域不可用", () => {
    expect(() => compilePolicy({ ...baseConfig(), filter: { mode: "maybe", rules: [] } })).toThrow(
      expect.objectContaining({ status: 503, code: "rule_group_invalid" }),
    );
    expect(() => compilePolicy({ ...baseConfig(), schema_version: 99 })).toThrow(
      expect.objectContaining({ status: 503, code: "rule_group_unsupported_version" }),
    );
    expect(() => compileStoredPolicy("{not json")).toThrow(expect.objectContaining({ code: "rule_group_invalid" }));
    expect(() => grantPolicy(JSON.stringify({ broken: true }))).toThrow(expect.objectContaining({ code: "rule_group_invalid" }));
  });

  it("授权未指定规则组：黑名单、无规则、full 视图", () => {
    const policy = grantPolicy(null);
    expect(policy.mode).toBe("blacklist");
    expect(policy.rules).toEqual([]);
    expect(policy.config.present.view).toBe("full");
  });
});

describe("详情越权与一致性", () => {
  it("规则不通过的邮件：列表不出现，详情 404", async () => {
    const blocked = await putMail({ address: A, subject: "Reset your password" });
    const ok = await putMail({ address: A, subject: "Your code" });
    const scope = scopeOf([A], denySubject("reset"));
    expect((await list(scope)).items.map((item) => item.id)).toEqual([ok]);
    await expect404(detail(scope, blocked));
  });

  it("code_only / meta_only 视图没有详情：404", async () => {
    const id = await putMail({ address: A, subject: "登录验证码 635217", text: "你的登录验证码是 635217" });
    await expect404(detail(scopeOf([A], baseConfig({ present: { view: "meta_only" } })), id));
    const codeOnly = scopeOf([A], baseConfig({ present: { view: "code_only", snippet: false, attachments: "hidden" } }));
    expect((await list(codeOnly)).items[0]).toMatchObject({ id, code: "635217" });
    await expect404(detail(codeOnly, id));
  });

  it("正文超长 + 正文类 deny：列表与详情都不可见（详情判定用正文同样截到索引上限，02 §3.5）", async () => {
    const id = await insertMail({ address: A, raw: buildLargeMail() });
    const scope = scopeOf([A], {
      ...baseConfig(),
      filter: {
        mode: "blacklist",
        rules: [{ id: "d", name: "屏蔽", enabled: true, effect: "deny", when: { field: "body", op: "contains", value: "forbidden-phrase" } }],
      },
    });
    expect((await list(scope)).items).toEqual([]);
    await expect404(detail(scope, id));
  });

  it("正文超长但没有正文类规则：列表与详情都可见，详情展示正文是完整的 display_body", async () => {
    const id = await insertMail({ address: A, raw: buildLargeMail() });
    const scope = scopeOf([A], denySubject("unrelated"));
    expect((await list(scope)).items.map((item) => item.id)).toEqual([id]);
    expect((await detail(scope, id)).text).toContain(LARGE_MAIL_TAIL_MARKER);
  });

  it("MAIL_DB 里已删除的邮件：详情 404", async () => {
    const id = await putMail({ address: A });
    const scope = scopeOf([A]);
    expect((await detail(scope, id)).id).toBe(id);
    await env.MAIL_DB.prepare("DELETE FROM raw_mails WHERE id = ?").bind(id).run();
    await expect404(detail(scope, id));
  });
});

describe("详情呈现", () => {
  const html = '<p>Hi <a href="https://example.org/x">link</a></p><script>alert(1)</script><img src="https://t.example/p.gif">';

  it("full 视图：清洗后的 HTML 以 CSP meta 开头，无脚本，远程图片按配置阻止", async () => {
    const id = await putMail({ address: A, html });
    const shown = await detail(scopeOf([A], baseConfig({ present: { view: "full" } })), id);
    expect(shown.html?.startsWith('<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(shown.html).not.toContain("<script");
    expect(shown.html).not.toContain("t.example");
    expect(shown.text).toContain("plain body");
  });

  it("remote_images 覆盖只对管理员作用域生效", async () => {
    const id = await putMail({ address: A, html });
    const admin = await detail(scopeOf([A], null), id, "allow");
    expect(admin.html).toContain("https://t.example/p.gif");
    const link = await detail(scopeOf([A], baseConfig({ present: { view: "full" } })), id, "allow");
    expect(link.html).not.toContain("t.example");
  });

  it("HTML 部分连取文字都失败（lol-html 放弃解析）：整封按解析失败处理，列表与详情都不可见", async () => {
    const id = await putMail({ address: A, html: "<select><style>p{}</style></select><img src=x onerror=alert(1)>" });
    const scope = scopeOf([A], baseConfig({ present: { view: "full" } }));
    expect((await list(scope)).items).toEqual([]);
    await expect404(detail(scope, id));
  });
});

describe("附件", () => {
  it("每次重走流水线；规则组 attachments 必须是 download", async () => {
    const id = await putMail({ address: A, attachment: { name: "a.txt", content: "hello" } });
    const now = nowSec();
    await expect404(getVisibleAttachment(env, scopeOf([A]), id, 0, { now }));
    const download = scopeOf([A], baseConfig({ present: { attachments: "download" } }));
    const file = await getVisibleAttachment(env, download, id, 0, { now });
    expect(file.filename).toBe("a.txt");
    expect(new TextDecoder().decode(file.content)).toContain("hello");
    await expect(getVisibleAttachment(env, download, id, 5, { now })).rejects.toMatchObject({ status: 404 });
    await expect404(getVisibleAttachment(env, scopeOf([B], baseConfig({ present: { attachments: "download" } })), id, 0, { now }));
  });
});
