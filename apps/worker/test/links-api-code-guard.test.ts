import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { LinkApiCodeResponse } from "@maillink/shared";
import {
  LINK_PASSWORD_BUSY_RETRY_SEC,
  LINK_PASSWORD_INFLIGHT_TTL_SEC,
  LINK_PASSWORD_MAX_FAILURES,
  LINK_PASSWORD_MAX_INFLIGHT,
} from "../src/constants";
import { runDailyCleanup } from "../src/cron/cleanup";
import { claimPasswordCheck, passwordIpBucket, settlePasswordCheck } from "../src/db/link-password";
import { buildMail } from "./access-helpers";
import { adminSession, resetApp } from "./helpers";
import { accessLogs, importMailboxes, linkRow, publicApi, tableCounts } from "./link-helpers";
import { d1Time, insertMail } from "./mail-helpers";
import { apiCode, apiCodeOk, apiError, codeMail, codeOnlyConfig, linkWith } from "./api-code-helpers";

// API 取码安全验收后的补充：X-MailLink-Api 头与 HEAD、口令"进行中 / 已失败"分开（迁移 0011）、邮件 id 复用、IP / 国家白名单。

let cookie: string;
let mailboxId: number;
const PASSWORD = "open-sesame";
const IP = "198.51.100.9";
const nowSec = () => Math.floor(Date.now() / 1000);
const count = async (table: string) => (await env.APP_DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0;

beforeEach(async () => {
  await resetApp();
  cookie = (await adminSession()).cookie;
  mailboxId = (await importMailboxes(cookie, ["box@example.com"])).get("box@example.com") as number;
});

const link = (access = {}) => linkWith(cookie, mailboxId, codeOnlyConfig(), { access });

describe("预览机器人防护", () => {
  it("缺 X-MailLink-Api: 1：400 api_header_required，没有任何副作用（不查口令、不登记设备、不激活、不计次、不写日志）", async () => {
    await codeMail("111111");
    const { id, token } = await link({ reveal: "click", max_deliveries_total: 3, password: PASSWORD });
    const variants: Array<Record<string, string>> = [{}, { "X-MailLink-Api": "true" }, { "X-MailLink-Api": "0" }];
    for (const headers of variants) {
      const res = await apiCode(token, { withoutApiHeader: true, headers: { ...headers, "X-Link-Password": "wrong-pass" } });
      expect(await apiError(res)).toMatchObject({ status: 400, code: "api_header_required" });
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(await tableCounts()).toMatchObject({ link_visitors: 0, link_deliveries: 0, link_access_logs: 0 });
    expect(await count("link_password_attempts")).toBe(0);
    expect((await linkRow(id)).first_access_at).toBeNull();
    const ok = await apiCodeOk(token, { password: PASSWORD });
    expect(ok.remaining).toEqual({ total: 2, today: null });
    await apiCode(token, { withoutApiHeader: true });
    expect((await apiCodeOk(token, { password: PASSWORD })).remaining).toEqual({ total: 2, today: null });
  });

  it("HEAD 一律 405，带了头也不产生副作用", async () => {
    await codeMail("111111");
    const { id, token } = await link({ reveal: "click", max_deliveries_total: 3 });
    const res = await apiCode(token, { method: "HEAD" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
    expect(await tableCounts()).toMatchObject({ link_visitors: 0, link_deliveries: 0, link_access_logs: 0 });
    expect((await linkRow(id)).first_access_at).toBeNull();
  });
});

describe("口令：进行中与已失败分开", () => {
  it("12 个正确口令并发：只有 200 或 link_password_busy（Retry-After 很短），不出现 link_password_locked，不计失败；之后单发 200", async () => {
    await codeMail("111111");
    const { token } = await link({ password: PASSWORD });
    const results = await Promise.all(Array.from({ length: 12 }, () => apiCode(token, { password: PASSWORD, visitor: { ip: IP } })));
    const codes = await Promise.all(results.map(async (res) => (res.status === 200 ? "ok" : (await apiError(res.clone())).code)));
    expect(codes.filter((code) => code !== "ok" && code !== "link_password_busy")).toEqual([]);
    expect(codes.filter((code) => code === "ok").length).toBeGreaterThanOrEqual(LINK_PASSWORD_MAX_INFLIGHT);
    for (const res of results.filter((item) => item.status === 429)) {
      expect(Number(res.headers.get("Retry-After"))).toBe(LINK_PASSWORD_BUSY_RETRY_SEC);
    }
    expect(await count("link_password_attempts")).toBe(0);
    expect(await count("link_password_inflight")).toBe(0);
    expect((await apiCodeOk(token, { password: PASSWORD, visitor: { ip: IP } })).code).toBe("111111");
  });

  it("网页开始取码同一机制：12 个正确口令并发没有 link_password_locked", async () => {
    const { token } = await link({ password: PASSWORD });
    const results = await Promise.all(Array.from({ length: 12 }, () => publicApi(`/api/s/${token}/start`, { ip: IP }, { json: { password: PASSWORD } })));
    const codes = await Promise.all(results.map(async (res) => (res.status === 200 ? "ok" : (await apiError(res)).code)));
    expect(codes.filter((code) => code !== "ok" && code !== "link_password_busy")).toEqual([]);
    expect(await count("link_password_attempts")).toBe(0);
  });

  it("错误口令并发 20 次：没有一次通过，失败数不超过 失败上限 + 进行中上限，之后正确口令也被锁定", async () => {
    const { token } = await link({ password: PASSWORD });
    const results = await Promise.all(Array.from({ length: 20 }, () => apiCode(token, { password: "wrong-pass", visitor: { ip: IP } })));
    expect(results.some((res) => res.status === 200)).toBe(false);
    const failures = await count("link_password_attempts");
    expect(failures).toBeGreaterThanOrEqual(1);
    expect(failures).toBeLessThan(LINK_PASSWORD_MAX_FAILURES + LINK_PASSWORD_MAX_INFLIGHT);
    for (let index = failures; index < LINK_PASSWORD_MAX_FAILURES; index += 1) await apiCode(token, { password: "wrong-pass", visitor: { ip: IP } });
    expect(await apiError(await apiCode(token, { password: PASSWORD, visitor: { ip: IP } }))).toMatchObject({ status: 429, code: "link_password_locked" });
  });

  it("上限的确切口径：已错 上限−1 次时，最多还有 进行中上限 个同时在校验；全部失败后锁定（共 失败上限 + 进行中上限 − 1 次）", async () => {
    const { id } = await link({ password: PASSWORD });
    const bucket = passwordIpBucket(IP);
    const now = nowSec();
    for (let index = 0; index < LINK_PASSWORD_MAX_FAILURES - 1; index += 1) {
      await env.APP_DB.prepare("INSERT INTO link_password_attempts (link_id, ip_bucket, created_at) VALUES (?, ?, ?)").bind(id, bucket, now).run();
    }
    const claims = await Promise.all(Array.from({ length: LINK_PASSWORD_MAX_INFLIGHT + 1 }, () => claimPasswordCheck(env.APP_DB, id, bucket, now)));
    const claimed = claims.flatMap((claim) => (claim.kind === "claimed" ? [claim.id] : []));
    expect(claimed).toHaveLength(LINK_PASSWORD_MAX_INFLIGHT);
    expect(claims.filter((claim) => claim.kind === "busy")).toHaveLength(1);
    for (const claimId of claimed) await settlePasswordCheck(env.APP_DB, claimId, { linkId: id, bucket, now });
    expect(await count("link_password_attempts")).toBe(LINK_PASSWORD_MAX_FAILURES + LINK_PASSWORD_MAX_INFLIGHT - 1);
    expect((await claimPasswordCheck(env.APP_DB, id, bucket, now)).kind).toBe("locked");
  });

  it("占位过期兜底：残留的过期占位不再计数，口令照常校验；每日清理删掉它们", async () => {
    await codeMail("111111");
    const { id, token } = await link({ password: PASSWORD });
    const bucket = passwordIpBucket(IP);
    const insert = (expiresAt: number) =>
      env.APP_DB.prepare("INSERT INTO link_password_inflight (link_id, ip_bucket, expires_at) VALUES (?, ?, ?)").bind(id, bucket, expiresAt).run();
    for (let index = 0; index < LINK_PASSWORD_MAX_INFLIGHT; index += 1) await insert(nowSec() + LINK_PASSWORD_INFLIGHT_TTL_SEC);
    expect((await apiError(await apiCode(token, { password: PASSWORD, visitor: { ip: IP } }))).code).toBe("link_password_busy");
    await env.APP_DB.prepare("UPDATE link_password_inflight SET expires_at = ?").bind(nowSec() - 1).run();
    expect((await apiCodeOk(token, { password: PASSWORD, visitor: { ip: IP } })).code).toBe("111111");
    expect((await runDailyCleanup(env, nowSec())).link_password_inflight_deleted).toBe(LINK_PASSWORD_MAX_INFLIGHT);
    expect(await count("link_password_inflight")).toBe(0);
  });

  it("校验抛异常：释放占位、不计失败（500 暴露）", async () => {
    const { id, token } = await link({ password: PASSWORD });
    const access = JSON.parse(String((await linkRow(id)).access)) as Record<string, unknown>;
    await env.APP_DB.prepare("UPDATE share_links SET access = ? WHERE id = ?").bind(JSON.stringify({ ...access, password_hash: "broken" }), id).run();
    expect((await apiCode(token, { password: PASSWORD })).status).toBe(500);
    expect(await count("link_password_inflight")).toBe(0);
    expect(await count("link_password_attempts")).toBe(0);
  });
});

describe("API 路径上的其他约束", () => {
  it("邮件 id 被新邮件复用：按未取过处理，返回新验证码并重新计次", async () => {
    const mailId = await codeMail("111111", 60);
    const { token } = await link({ reveal: "click", max_deliveries_total: 5 });
    expect((await apiCodeOk(token)).remaining).toEqual({ total: 4, today: null });
    await env.MAIL_DB.prepare("DELETE FROM raw_mails WHERE id = ?").bind(mailId).run();
    await insertMail({
      id: mailId,
      message_id: "<reused@example.org>",
      address: "box@example.com",
      raw: buildMail({ to: "box@example.com", from: "noreply@login.example.org", subject: "Sign in again", text: "Your verification code is 222222" }),
      created_at: d1Time(nowSec() - 30),
    });
    const body: LinkApiCodeResponse = await apiCodeOk(token);
    expect(body).toMatchObject({ code: "222222", mail_id: mailId, remaining: { total: 3, today: null } });
    expect((await tableCounts()).link_deliveries).toBe(2);
  });

  it("IP 与国家白名单：不在白名单 410 link_unavailable，日志记具体原因；在白名单内 200", async () => {
    await codeMail("111111");
    const byIp = await link({ ip_allow: ["192.0.2.0/24"] });
    expect(await apiError(await apiCode(byIp.token, { visitor: { ip: "198.51.100.1" } }))).toMatchObject({ status: 410, code: "link_unavailable" });
    expect((await accessLogs(byIp.id)).at(-1)).toMatchObject({ event: "api_code", reason: "ip_denied" });
    expect((await apiCodeOk(byIp.token, { visitor: { ip: "192.0.2.10" } })).code).toBe("111111");
    const byCountry = await link({ country_allow: ["JP"] });
    expect(await apiError(await apiCode(byCountry.token, { visitor: { country: "US" } }))).toMatchObject({ status: 410, code: "link_unavailable" });
    expect(await apiError(await apiCode(byCountry.token))).toMatchObject({ status: 410, code: "link_unavailable" });
    expect((await accessLogs(byCountry.id)).map((log) => log.reason)).toEqual(["country_denied", "country_denied"]);
    expect((await apiCodeOk(byCountry.token, { visitor: { country: "JP" } })).code).toBe("111111");
  });
});
