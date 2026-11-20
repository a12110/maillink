import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminShareLink } from "@maillink/shared";
import { LINK_PASSWORD_MAX_FAILURES } from "../src/constants";
import { adminSession, api, resetApp } from "./helpers";
import { accessLogs, importMailboxes, linkRow, publicApi, tableCounts } from "./link-helpers";
import { enableTurnstile } from "./settings-helpers";
import { apiCode, apiCodeOk, apiError, codeMail, codeOnlyConfig, linkWith } from "./api-code-helpers";

// API 取码的访问约束：检查顺序、错误码、口令头、设备、人机验证、access.api。

let cookie: string;
let mailboxId: number;
const nowSec = () => Math.floor(Date.now() / 1000);

beforeEach(async () => {
  await resetApp();
  cookie = (await adminSession()).cookie;
  mailboxId = (await importMailboxes(cookie, ["box@example.com"])).get("box@example.com") as number;
  await codeMail("123456");
});
afterEach(() => vi.restoreAllMocks());

const link = (extra = {}) => linkWith(cookie, mailboxId, codeOnlyConfig(), extra);
const base64Utf8 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const setColumns = (id: number, sql: string, ...values: unknown[]) =>
  env.APP_DB.prepare(`UPDATE share_links SET ${sql} WHERE id = ?`).bind(...values, id).run();

describe("链接状态与通用错误", () => {
  it("token 不存在 404；撤销 / 暂停 / 过期 410（不透露原因，日志有原因）；未生效 403", async () => {
    expect((await apiError(await apiCode("A".repeat(43)))).code).toBe("link_not_found");
    for (const [sql, reason] of [["status = 'revoked'", "revoked"], ["status = 'paused'", "paused"]] as const) {
      const { id, token } = await link();
      await setColumns(id, sql);
      expect(await apiError(await apiCode(token))).toMatchObject({ status: 410, code: "link_unavailable" });
      expect((await accessLogs(id)).at(-1)).toEqual({ event: "api_code", reason, mail_id: null });
    }
    const expired = await link();
    await setColumns(expired.id, "expires_at = ?", nowSec() - 1);
    expect((await apiError(await apiCode(expired.token))).status).toBe(410);
    const future = await link({ valid_from: nowSec() + 3600 });
    expect(await apiError(await apiCode(future.token))).toMatchObject({ status: 403, code: "link_not_yet_valid" });
  });

  it("限流：LINK_RATE_LIMITER 超限 429 rate_limited", async () => {
    const { token } = await link();
    const denyAll: RateLimit = { limit: async () => ({ success: false }) };
    const res = await apiCode(token, { bindings: { LINK_RATE_LIMITER: denyAll } });
    expect(await apiError(res)).toMatchObject({ status: 429, code: "rate_limited" });
    expect(res.headers.get("Retry-After")).not.toBeNull();
  });

  it("规则组 JSON 损坏：503，不返回任何验证码", async () => {
    const { id, token } = await link();
    await env.APP_DB.prepare("UPDATE rule_groups SET config = '{}' WHERE id = (SELECT rule_group_id FROM share_links WHERE id = ?)").bind(id).run();
    const res = await apiCode(token);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("123456");
  });

  it("access.api = false：403 api_disabled；管理端视图返回 api；存量 JSON 缺字段按开", async () => {
    const { id, token } = await link({ access: { api: false } });
    const view = await (await api(`/api/admin/links/${id}`, { cookie })).json<AdminShareLink>();
    expect(view.access.api).toBe(false);
    expect(await apiError(await apiCode(token))).toMatchObject({ status: 403, code: "api_disabled" });
    expect((await accessLogs(id)).at(-1)).toEqual({ event: "api_code", reason: "api_disabled", mail_id: null });
    expect((await tableCounts()).link_visitors).toBe(0);

    const legacy = await link();
    const stored = JSON.parse(String((await linkRow(legacy.id)).access)) as Record<string, unknown>;
    expect(stored["api"]).toBe(true);
    delete stored["api"];
    await setColumns(legacy.id, "access = ?", JSON.stringify(stored));
    expect((await (await api(`/api/admin/links/${legacy.id}`, { cookie })).json<AdminShareLink>()).access.api).toBe(true);
    expect((await apiCodeOk(legacy.token)).code).toBe("123456");
  });

  it("开了人机验证的链接：403 turnstile_required，不登记设备", async () => {
    await enableTurnstile(cookie, ["pickup"]);
    const { id, token } = await link({ access: { turnstile: true } });
    expect(await apiError(await apiCode(token))).toMatchObject({ status: 403, code: "turnstile_required" });
    expect((await tableCounts()).link_visitors).toBe(0);
    expect((await linkRow(id)).first_access_at).toBeNull();
  });

  it("GET 不经 CSRF：不带 Origin 与 CSRF 头也能调用", async () => {
    const { token } = await link();
    const res = await apiCode(token);
    expect(res.status).toBe(200);
  });
});

describe("口令头 X-Link-Password", () => {
  const PASSWORD = "open-sesame";

  it("缺口令 400；错误 403；正确 200", async () => {
    const { id, token } = await link({ access: { password: PASSWORD } });
    expect(await apiError(await apiCode(token))).toMatchObject({ status: 400, code: "link_password_required" });
    expect(await apiError(await apiCode(token, { password: "wrong-pass" }))).toMatchObject({ status: 403, code: "link_password_invalid" });
    expect((await apiCodeOk(token, { password: PASSWORD })).code).toBe("123456");
    expect((await accessLogs(id)).map((log) => [log.event, log.reason])).toEqual([
      ["api_code", "bad_password"],
      ["api_code", "ok"],
    ]);
  });

  it("错误计入现有口令锁定：错满后正确口令也 429 link_password_locked + Retry-After；取件页同样被锁", async () => {
    const { token } = await link({ access: { password: PASSWORD } });
    for (let index = 0; index < LINK_PASSWORD_MAX_FAILURES; index += 1) {
      expect((await apiCode(token, { password: "wrong-pass" })).status).toBe(403);
    }
    const locked = await apiCode(token, { password: PASSWORD });
    expect(await apiError(locked)).toMatchObject({ status: 429, code: "link_password_locked" });
    expect(Number(locked.headers.get("Retry-After"))).toBeGreaterThan(0);
    const web = await publicApi(`/api/s/${token}/start`, {}, { json: { password: PASSWORD } });
    expect(web.status).toBe(429);
  });

  it("X-Link-Password 只接受 ASCII：含非 ASCII 字符 400 link_password_encoding，不进 PBKDF2、不占口令名额", async () => {
    const { token } = await link({ access: { password: "口令-1234" } });
    // 测试环境里请求头按 JS 字符串直达；真实请求经 workerd 按 UTF-8 解码后同样是非 ASCII 字符
    for (const value of ["口令-1234", "café-1234", String.fromCharCode(...new TextEncoder().encode("口令-1234"))]) {
      expect(await apiError(await apiCode(token, { password: value }))).toMatchObject({ status: 400, code: "link_password_encoding" });
    }
    expect((await env.APP_DB.prepare("SELECT COUNT(*) AS n FROM link_password_attempts").first<{ n: number }>())?.n).toBe(0);
  });

  it("X-Link-Password-Base64：UTF-8 字节的 base64，中文与 Latin-1 范围字符都能通过；错误口令 403", async () => {
    for (const password of ["口令-1234", "café-1234"]) {
      const { token } = await link({ access: { password } });
      expect((await apiCodeOk(token, { headers: { "X-Link-Password-Base64": base64Utf8(password) } })).code).toBe("123456");
      const wrong = await apiCode(token, { headers: { "X-Link-Password-Base64": base64Utf8(`${password}x`) } });
      expect((await apiError(wrong)).code).toBe("link_password_invalid");
    }
  });

  it("两个口令头同时出现、base64 无效、解码后不是 UTF-8：400 link_password_encoding", async () => {
    const { token } = await link({ access: { password: PASSWORD } });
    const cases: Array<Record<string, string>> = [
      { "X-Link-Password": PASSWORD, "X-Link-Password-Base64": base64Utf8(PASSWORD) },
      { "X-Link-Password-Base64": "not base64!" },
      { "X-Link-Password-Base64": "b3Blbi1zZXNhbWU" },
      { "X-Link-Password-Base64": btoa(String.fromCharCode(0xff, 0xfe, 0x41, 0x42)) },
    ];
    for (const headers of cases) {
      expect(await apiError(await apiCode(token, { headers }))).toMatchObject({ status: 400, code: "link_password_encoding" });
    }
    expect((await apiCodeOk(token, { headers: { "X-Link-Password-Base64": base64Utf8(PASSWORD) } })).code).toBe("123456");
  });

  it("口令通过前不登记设备、不激活", async () => {
    const { id, token } = await link({ access: { password: PASSWORD } });
    await apiCode(token, { password: "wrong-pass" });
    expect((await tableCounts()).link_visitors).toBe(0);
    expect((await linkRow(id)).first_access_at).toBeNull();
  });
});

describe("设备", () => {
  it("名额已被浏览器占满且 API 未登记：403 link_device_limit；API 先登记后，浏览器反而被挡", async () => {
    const webFirst = await link({ access: { max_devices: 1 } });
    expect((await publicApi(`/api/s/${webFirst.token}/start`, {}, { json: {} })).status).toBe(200);
    expect(await apiError(await apiCode(webFirst.token))).toMatchObject({ status: 403, code: "link_device_limit" });
    expect((await accessLogs(webFirst.id)).at(-1)).toEqual({ event: "api_code", reason: "device_limit", mail_id: null });

    const apiFirst = await link({ access: { max_devices: 1 } });
    await apiCodeOk(apiFirst.token);
    await apiCodeOk(apiFirst.token);
    const web = await publicApi(`/api/s/${apiFirst.token}/start`, {}, { json: {} });
    expect((await apiError(web)).code).toBe("link_device_limit");
  });

  it("管理员重置设备后 API 重新登记", async () => {
    const { id, token } = await link({ access: { max_devices: 1 } });
    await apiCodeOk(token);
    await api(`/api/admin/links/${id}/reset`, { cookie, json: { reset_devices: true } });
    expect((await tableCounts()).link_visitors).toBe(0);
    await apiCodeOk(token);
    expect((await tableCounts()).link_visitors).toBe(1);
  });
});
