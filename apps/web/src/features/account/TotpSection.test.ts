// @vitest-environment happy-dom
import { useQuery } from "@tanstack/react-query";
import { createElement, Fragment } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@maillink/shared";
import { sessionQuery } from "../../api/queries";
import { byText, inputByLabel, settle, submit } from "../../test/dom";
import { errorReply, installFakeFetch } from "../../test/fake-fetch";
import { makePublicConfig } from "../../test/fixtures";
import type { FakeFetch } from "../../test/fake-fetch";
import { mountWithProviders } from "../../test/providers";
import { click, typeInto } from "../../test/render";
import type { Mounted } from "../../test/render";
import { TotpSection } from "./TotpSection";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const CONFIG = makePublicConfig();
const CODES = Array.from({ length: 10 }, (_, i) => `CODE${i}-ABCDE`);
const SETUP = { secret: "JBSWY3DPEHPK3PXP", otpauth_uri: "otpauth://totp/MailLink:alice?secret=JBSWY3DPEHPK3PXP&issuer=MailLink", expires_at: 2_000_000_000 };

function me(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: 1, username: "alice", display_name: null, email: null, role: "user", has_password: true,
    totp_enabled: false, recovery_codes_remaining: 0, created_at: 1, last_login_at: null, ...overrides,
  };
}

/** 外壳里一直在观察会话（admin_2fa_required 引导条）；这里用一个常驻观察者代表它，才看得到“失效后重取” */
function SessionProbe() {
  useQuery(sessionQuery());
  return null;
}

async function open(user: MeResponse): Promise<{ box: HTMLElement; server: FakeFetch }> {
  const server = installFakeFetch({
    "GET /api/public/config": { json: CONFIG },
    "GET /api/auth/session": { json: { user: { id: 1, username: "alice", display_name: null, email: null, role: "admin" }, auth_methods: ["password"], expires_at: 2_000_000_000, admin_2fa_required: true } },
    "POST /api/me/totp/setup": { json: SETUP },
    "POST /api/me/totp/enable": { json: { recovery_codes: CODES } },
    "POST /api/me/recovery-codes": { json: { recovery_codes: CODES } },
    "DELETE /api/me/totp": { json: { status: "ok" } },
  });
  mounted = await mountWithProviders(createElement(Fragment, null, createElement(SessionProbe), createElement(TotpSection, { me: user })));
  await settle();
  return { box: mounted.container, server };
}

async function startSetup(box: HTMLElement): Promise<void> {
  await click(byText(box, "button", "启用两步验证"));
  await settle();
}

function formOf(box: HTMLElement): HTMLFormElement {
  const form = box.querySelector("form");
  if (!form) throw new Error("没有表单");
  return form;
}

describe("启用两步验证：setup → enable → 恢复码只显示一次", () => {
  it("setup 展示本地生成的二维码与手输密钥；提交验证码 + 当前密码；恢复码展示 10 个，确认后消失", async () => {
    const { box, server } = await open(me());
    await startSetup(box);

    expect(server.callsTo("POST /api/me/totp/setup")).toHaveLength(1);
    const qr = box.querySelector("svg.qr");
    expect(qr?.querySelector("path")?.getAttribute("d")?.length).toBeGreaterThan(100);
    expect(box.querySelector("code")?.textContent).toBe(SETUP.secret);
    // 二维码是本地算出来的：只有本站的 setup / public config / session 请求，没有任何别的
    expect(server.calls.map((call) => call.path).sort()).toEqual(["/api/auth/session", "/api/me/totp/setup", "/api/public/config"]);

    await typeInto(inputByLabel(box, "验证码"), "123456");
    await typeInto(inputByLabel(box, "当前密码"), "pw-current");
    const sessionCallsBefore = server.callsTo("GET /api/auth/session").length;
    await submit(formOf(box));
    await settle();

    expect(server.callsTo("POST /api/me/totp/enable")[0]?.body).toEqual({ code: "123456", password: "pw-current" });
    // 启用成功后会话缓存失效并重取（否则 admin_2fa_required 引导会残留）
    expect(server.callsTo("GET /api/auth/session").length).toBe(sessionCallsBefore + 1);
    const shown = Array.from(box.querySelectorAll(".recovery-grid li")).map((li) => li.textContent);
    expect(shown).toEqual(CODES);
    expect(box.textContent).toContain("恢复码只显示这一次");
    expect(box.querySelector("svg.qr")).toBeNull();

    await click(byText(box, "button", "我已保存，完成"));
    expect(box.querySelector(".recovery-grid")).toBeNull();
    expect(box.textContent).not.toContain(CODES[0]);
  });

  it("验证码错误：留在 setup，显示原因，没有恢复码", async () => {
    const { box, server } = await open(me());
    server.set("POST /api/me/totp/enable", errorReply(400, "invalid_totp_code", "验证码错误"));
    await startSetup(box);
    await typeInto(inputByLabel(box, "验证码"), "000000");
    await typeInto(inputByLabel(box, "当前密码"), "pw");
    await submit(formOf(box));
    await settle();
    expect(box.textContent).toContain("验证码错误");
    expect(box.querySelector("svg.qr")).not.toBeNull();
    expect(box.querySelector(".recovery-grid")).toBeNull();
  });

  it("当前密码错误显示在密码框下（reauth_failed）", async () => {
    const { box, server } = await open(me());
    server.set("POST /api/me/totp/enable", errorReply(400, "reauth_failed", "当前密码或验证码错误"));
    await startSetup(box);
    await typeInto(inputByLabel(box, "验证码"), "123456");
    await typeInto(inputByLabel(box, "当前密码"), "wrong");
    await submit(formOf(box));
    await settle();
    expect(byText(box, ".field-error", "当前密码或验证码错误")).toBeTruthy();
  });

  it("没有密码的账号：请求体只有 code（后端按“最近登录”再确认）", async () => {
    const { box, server } = await open(me({ has_password: false }));
    await startSetup(box);
    expect(box.textContent).toContain("你的账号没有密码");
    await typeInto(inputByLabel(box, "验证码"), "123456");
    await submit(formOf(box));
    await settle();
    expect(server.callsTo("POST /api/me/totp/enable")[0]?.body).toEqual({ code: "123456" });
  });

  it("setup 过期：提示重新开始", async () => {
    const { box, server } = await open(me());
    server.set("POST /api/me/totp/enable", errorReply(400, "totp_setup_expired", "设置已过期，请重新开始"));
    await startSetup(box);
    await typeInto(inputByLabel(box, "验证码"), "123456");
    await typeInto(inputByLabel(box, "当前密码"), "pw");
    await submit(formOf(box));
    await settle();
    expect(box.textContent).toContain("设置已过期");
  });
});

describe("已启用：剩余恢复码、重新生成、关闭", () => {
  const enabled = me({ totp_enabled: true, recovery_codes_remaining: 7 });

  it("显示剩余恢复码数", async () => {
    const { box } = await open(enabled);
    expect(box.textContent).toContain("已启用");
    expect(byText(box, "b.num", "7")).toBeTruthy();
  });

  it("重新生成需要再确认：用验证码时请求体是 {code}；成功后一次性展示新恢复码", async () => {
    const { box, server } = await open(enabled);
    await click(byText(box, "button", "重新生成恢复码"));
    const dialog = document.body.querySelector<HTMLElement>("[role=dialog]");
    if (!dialog) throw new Error("没有弹出对话框");
    await click(byText(dialog, "label", "验证码"));
    await typeInto(inputByLabel(dialog, "验证码"), "654321");
    await submit(dialog.querySelector("form") as HTMLFormElement);
    await settle();
    expect(server.callsTo("POST /api/me/recovery-codes")[0]?.body).toEqual({ code: "654321" });
    expect(box.querySelectorAll(".recovery-grid li")).toHaveLength(10);
  });

  it("关闭需要当前密码；reauth_required 之类的错误留在对话框里", async () => {
    const { box, server } = await open(enabled);
    server.set("DELETE /api/me/totp", errorReply(400, "reauth_failed", "当前密码或验证码错误"));
    await click(byText(box, "button", "关闭两步验证"));
    const dialog = document.body.querySelector<HTMLElement>("[role=dialog]");
    if (!dialog) throw new Error("没有弹出对话框");
    await typeInto(inputByLabel(dialog, "当前密码"), "wrong");
    await submit(dialog.querySelector("form") as HTMLFormElement);
    await settle();
    expect(server.callsTo("DELETE /api/me/totp")[0]?.body).toEqual({ password: "wrong" });
    expect(dialog.textContent).toContain("当前密码或验证码错误");
  });

  it("关闭成功后同样刷新会话", async () => {
    const { box, server } = await open(enabled);
    const before = server.callsTo("GET /api/auth/session").length;
    await click(byText(box, "button", "关闭两步验证"));
    const dialog = document.body.querySelector<HTMLElement>("[role=dialog]");
    if (!dialog) throw new Error("没有弹出对话框");
    await typeInto(inputByLabel(dialog, "当前密码"), "pw");
    await submit(dialog.querySelector("form") as HTMLFormElement);
    await settle();
    expect(server.callsTo("DELETE /api/me/totp")).toHaveLength(1);
    expect(server.callsTo("GET /api/auth/session").length).toBe(before + 1);
  });
});
