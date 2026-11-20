import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  builtinRuleGroupTemplates,
  type AdminRuleGroupDetail,
  type AdminRuleGroupList,
  type RuleGroupSaveResponse,
  type RuleGroupTestResponse,
  type RuleGroupUsage,
} from "@maillink/shared";
import { nowSec } from "../src/clock";
import { baseConfig, putMail } from "./access-helpers";
import { adminSession, api, auditRows, createUser, resetApp } from "./helpers";
import { fixture, insertMail } from "./mail-helpers";

// 规则组 API（04 管理端 / 规则组）与测试器（02 §8）。

type ErrorBody = { error: { code: string; message: string; issues?: Array<{ code: string; path: unknown[] }>; usage?: RuleGroupUsage } };

let cookie = "";
let adminId = 0;
beforeEach(async () => {
  await resetApp();
  ({ id: adminId, cookie } = await adminSession());
});

const create = async (name: string, config: unknown = baseConfig()) => {
  const res = await api("/api/admin/rule-groups", { cookie, json: { name, config } });
  return { status: res.status, body: (await res.json()) as RuleGroupSaveResponse & ErrorBody };
};

async function insertLink(ruleGroupId: number): Promise<number> {
  const now = nowSec();
  const result = await env.APP_DB.prepare(
    `INSERT INTO share_links (name, token_hash, token_enc, token_hint, rule_group_id, access, created_at, updated_at)
     VALUES ('L1', 'h', 'e', 'abcdef', ?, '{}', ?, ?)`,
  )
    .bind(ruleGroupId, now, now)
    .run();
  return result.meta.last_row_id;
}

describe("增删改查", () => {
  it("创建：校验通过返回详情与警告；配置错误 400 附 issues；同名 409；写审计", async () => {
    const whitelistEmpty = baseConfig({ filter: { mode: "whitelist", rules: [] } });
    const ok = await create("g1", whitelistEmpty);
    expect(ok.status).toBe(201);
    expect(ok.body.rule_group).toMatchObject({ name: "g1", revision: 1, invalid: false, view: "text", link_count: 0 });
    expect(ok.body.warnings.map((w) => w.code)).toContain("whitelist_no_enabled_allow");

    const bad = await create("g2", baseConfig({ present: { view: "full", links: "strip" } }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("rule_group_invalid");
    expect(bad.body.error.issues?.map((i) => i.code)).toContain("full_view_with_link_filter");

    expect((await create("g1")).status).toBe(409);
    const audit = await auditRows("rule_group.create");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_user_id: adminId, target_type: "rule_group" });
  });

  it("列表带引用计数与\"配置无效\"标记", async () => {
    const { body } = await create("g1");
    const id = body.rule_group.id;
    await insertLink(id);
    await env.APP_DB.prepare("INSERT INTO rule_groups (name, schema_version, config, created_at, updated_at) VALUES ('broken', 9, '{\"schema_version\":9}', 0, 0)").run();
    const res = await api("/api/admin/rule-groups", { cookie });
    const list = (await res.json()) as AdminRuleGroupList;
    expect(list.items.find((g) => g.id === id)).toMatchObject({ link_count: 1, invalid: false });
    expect(list.items.find((g) => g.name === "broken")).toMatchObject({ invalid: true, invalid_code: "rule_group_unsupported_version" });
  });

  it("PUT 乐观锁：revision 不一致 409；成功后 revision+1，审计含旧配置", async () => {
    const { body } = await create("g1");
    const id = body.rule_group.id;
    const update = (revision: number, name = "g1-renamed") =>
      api(`/api/admin/rule-groups/${id}`, { cookie, method: "PUT", json: { name, config: baseConfig({ present: { view: "meta_only" } }), revision } });
    const ok = await update(1);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as RuleGroupSaveResponse).rule_group).toMatchObject({ revision: 2, name: "g1-renamed", view: "meta_only" });
    const stale = await update(1);
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as ErrorBody).error.code).toBe("revision_conflict");
    const detail = (await (await api(`/api/admin/rule-groups/${id}`, { cookie })).json()) as AdminRuleGroupDetail;
    expect(detail.revision).toBe(2);
    const audit = JSON.parse((await auditRows("rule_group.update"))[0]?.detail ?? "{}") as { before: { config: string } };
    expect(JSON.parse(audit.before.config)).toMatchObject({ present: { view: "text" } });
    expect((await api("/api/admin/rule-groups/9999", { cookie, method: "PUT", json: { name: "x", config: baseConfig(), revision: 1 } })).status).toBe(404);
  });

  it("DELETE：被引用时 409 并给出引用方；无引用时删除；usage 接口", async () => {
    const { body } = await create("g1");
    const id = body.rule_group.id;
    const linkId = await insertLink(id);
    const mailbox = await env.APP_DB.prepare("INSERT INTO mailboxes (address, address_lc, created_at, updated_at) VALUES ('a@x.com','a@x.com',0,0)").run();
    const userId = await createUser({ username: "u1" });
    await env.APP_DB.prepare("INSERT INTO user_mailbox_grants (user_id, mailbox_id, rule_group_id, created_at) VALUES (?, ?, ?, 0)")
      .bind(userId, mailbox.meta.last_row_id, id)
      .run();
    const usage = (await (await api(`/api/admin/rule-groups/${id}/usage`, { cookie })).json()) as RuleGroupUsage;
    expect(usage).toMatchObject({ link_count: 1, grant_count: 1, links: [{ id: linkId, name: "L1" }], grants: [{ username: "u1", address: "a@x.com" }] });

    const blocked = await api(`/api/admin/rule-groups/${id}`, { cookie, method: "DELETE" });
    expect(blocked.status).toBe(409);
    const error = ((await blocked.json()) as ErrorBody).error;
    expect(error.code).toBe("rule_group_in_use");
    expect(error.usage?.links.map((l) => l.id)).toEqual([linkId]);

    await env.APP_DB.prepare("DELETE FROM share_links").run();
    await env.APP_DB.prepare("DELETE FROM user_mailbox_grants").run();
    expect((await api(`/api/admin/rule-groups/${id}`, { cookie, method: "DELETE" })).status).toBe(200);
    expect((await api(`/api/admin/rule-groups/${id}`, { cookie })).status).toBe(404);
    expect(await auditRows("rule_group.delete")).toHaveLength(1);
  });
});

async function tableCounts(): Promise<Record<string, number>> {
  const { results } = await env.APP_DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
  ).all<{ name: string }>();
  const counts: Record<string, number> = {};
  for (const { name } of results) {
    counts[name] = (await env.APP_DB.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).first<{ n: number }>())?.n ?? 0;
  }
  return counts;
}

describe("POST /api/admin/rule-groups/test", () => {
  const otp = () => builtinRuleGroupTemplates().find((t) => t.name === "仅验证码")?.config;

  it("用未保存的配置逐封给出 visible / reason / matched / extracted / preview；除 mail_index 外无写入", async () => {
    const A = "alice@example.com";
    const code = await insertMail({ address: A, raw: fixture("verification-code.eml") });
    const reset = await insertMail({ address: A, raw: fixture("password-reset-code.eml") });
    const old = await putMail({ address: A, subject: "登录验证码 111222", text: "验证码 111222", ageSec: 3600 });
    const broken = await insertMail({ address: A, raw: fixture("malformed.eml") });
    const before = await tableCounts();
    const res = await api("/api/admin/rule-groups/test", { cookie, json: { config: otp(), addresses: [A], anchor_at: nowSec() - 300 } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as RuleGroupTestResponse;
    const byId = new Map(body.items.map((item) => [item.mail_id, item]));
    expect(byId.get(code)).toMatchObject({ visible: true, reason_code: "allow_match", preview: { id: code, code: "635217" } });
    expect(byId.get(code)?.preview?.recipient).toContain("***");
    expect(byId.get(reset)).toMatchObject({ visible: false, preview: null });
    expect(byId.get(reset)?.reason).toMatch(/^deny:|no_allow_match/u);
    expect(byId.get(old)).toMatchObject({ visible: false, reason_code: "out_of_window" });
    expect(byId.get(broken)).toMatchObject({ visible: false, reason_code: "parse_failed", parse_status: "failed" });
    // 窗口 10 分钟与 subject_created（anchor_at = 5 分钟前）取较晚者
    expect(body.time_lower_bound).toBeGreaterThanOrEqual(nowSec() - 305);

    const after = await tableCounts();
    expect({ ...after, mail_index: 0 }).toEqual({ ...before, mail_index: 0 });
    expect(after.mail_index).toBe(4);
  });

  it("按邮件 id 试跑；anchor_at 模拟创建时间；配置错误 400", async () => {
    const id = await putMail({ address: "a@example.com", ageSec: 600 });
    const config = baseConfig({ time: { since: { type: "subject_created" } } });
    const run = async (json: unknown) => (await (await api("/api/admin/rule-groups/test", { cookie, json })).json()) as RuleGroupTestResponse;
    expect((await run({ config, mail_ids: [id] })).items[0]).toMatchObject({ visible: false, reason_code: "out_of_window" });
    expect((await run({ config, mail_ids: [id], anchor_at: nowSec() - 3600 })).items[0]).toMatchObject({ visible: true });
    const bad = await api("/api/admin/rule-groups/test", { cookie, json: { config: { schema_version: 1 }, mail_ids: [id] } });
    expect(bad.status).toBe(400);
    const both = await api("/api/admin/rule-groups/test", { cookie, json: { config, mail_ids: [id], addresses: ["a@example.com"] } });
    expect(both.status).toBe(400);
  });

  it("max_mails 截掉的邮件标为 max_mails", async () => {
    for (let i = 0; i < 3; i += 1) await putMail({ address: "a@example.com", ageSec: 30 - i });
    const res = await api("/api/admin/rule-groups/test", { cookie, json: { config: baseConfig({ limits: { max_mails: 1 } }), addresses: ["a@example.com"] } });
    const body = (await res.json()) as RuleGroupTestResponse;
    expect(body.items.map((item) => item.reason_code)).toEqual(["blacklist_pass", "max_mails", "max_mails"]);
  });
});

describe("POST /api/admin/rule-groups/draft-from-mail", () => {
  it("从邮件生成 allow 规则草稿；不存在 404；解析失败 422", async () => {
    const id = await insertMail({ address: "a@example.com", raw: fixture("verification-code.eml") });
    const res = await api("/api/admin/rule-groups/draft-from-mail", { cookie, json: { mail_id: id } });
    expect(res.status).toBe(200);
    const draft = (await res.json()) as { rule: { effect: string } | null; code_regex: string | null; notes: string[] };
    expect(draft.rule?.effect).toBe("allow");
    expect((await api("/api/admin/rule-groups/draft-from-mail", { cookie, json: { mail_id: 99999 } })).status).toBe(404);
    const broken = await insertMail({ address: "a@example.com", raw: fixture("malformed.eml") });
    expect((await api("/api/admin/rule-groups/draft-from-mail", { cookie, json: { mail_id: broken } })).status).toBe(422);
  });
});
