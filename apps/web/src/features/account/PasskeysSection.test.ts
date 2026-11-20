// @vitest-environment happy-dom
import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse, PublicConfig } from "@maillink/shared";
import type { WebAuthnClient } from "../../lib/webauthn";
import { byText, inputByLabel, settle, submit } from "../../test/dom";
import { errorReply, installFakeFetch } from "../../test/fake-fetch";
import { makePublicConfig } from "../../test/fixtures";
import { mountWithProviders } from "../../test/providers";
import { click, typeInto } from "../../test/render";
import type { Mounted } from "../../test/render";
import { PasskeysSection } from "./PasskeysSection";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const OPTIONS: PublicKeyCredentialCreationOptionsJSON = {
  challenge: "chal",
  rp: { name: "MailLink", id: "localhost" },
  user: { id: "u", name: "alice", displayName: "alice" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
};
const CREDENTIAL: RegistrationResponseJSON = {
  id: "cred", rawId: "cred", type: "public-key", clientExtensionResults: {},
  response: { clientDataJSON: "a", attestationObject: "b" },
};
const CONFIG = makePublicConfig({ login_methods: ["password", "passkey"] });
const PASSKEYS = {
  items: [
    { id: 7, name: "MacBook", transports: ["internal"], created_at: 1_700_000_000, last_used_at: 1_700_100_000 },
    { id: 8, name: "YubiKey", transports: ["usb"], created_at: 1_700_000_000, last_used_at: null },
  ],
};

function me(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: 1, username: "alice", display_name: null, email: null, role: "user", has_password: true,
    totp_enabled: false, recovery_codes_remaining: 0, created_at: 1, last_login_at: null, ...overrides,
  };
}

async function open(user: MeResponse, config: PublicConfig = CONFIG) {
  const server = installFakeFetch({
    "GET /api/public/config": { json: config },
    "GET /api/me/passkeys": { json: PASSKEYS },
    "POST /api/me/passkeys/options": { json: OPTIONS },
    "POST /api/me/passkeys/verify": { status: 201, json: { ...PASSKEYS.items[0], id: 9, name: "新的" } },
    "DELETE /api/me/passkeys/8": { json: { status: "ok" } },
    "PATCH /api/me/passkeys/7": { json: { status: "ok" } },
  });
  const webauthn: WebAuthnClient = { supported: () => true, authenticate: vi.fn(), register: vi.fn(async () => CREDENTIAL) };
  mounted = await mountWithProviders(createElement(PasskeysSection, { me: user, webauthn }));
  await settle();
  return { box: mounted.container, server, webauthn };
}

function dialogOf(): HTMLElement {
  const dialog = document.body.querySelector<HTMLElement>("[role=dialog], [role=alertdialog]");
  if (!dialog) throw new Error("没有弹出对话框");
  return dialog;
}

async function submitDialog(): Promise<void> {
  const form = dialogOf().querySelector("form");
  if (!form) throw new Error("对话框里没有表单");
  await submit(form);
  await settle();
}

async function openAdd(box: HTMLElement): Promise<void> {
  await click(byText(box, "button", "添加通行密钥"));
}

describe("通行密钥列表", () => {
  it("显示名称、创建时间、最近使用（没用过就写没用过）", async () => {
    const { box } = await open(me());
    const rows = Array.from(box.querySelectorAll(".item-list li")).map((li) => li.textContent ?? "");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("MacBook");
    expect(rows[0]).toContain("最近使用");
    expect(rows[1]).toContain("YubiKey");
    expect(rows[1]).toContain("还没有用过");
  });

  it("站点没开放通行密钥时不能添加，但仍可管理已有的", async () => {
    const { box } = await open(me(), { ...CONFIG, login_methods: ["password"] });
    expect(byText<HTMLButtonElement>(box, "button", "添加通行密钥").disabled).toBe(true);
    expect(box.textContent).toContain("管理员暂未开放通行密钥登录");
    expect(box.querySelectorAll(".item-list li")).toHaveLength(2);
  });
});

describe("添加通行密钥：options 的三种再确认请求体", () => {
  it("{password}：有密码的账号，带名称", async () => {
    const { box, server, webauthn } = await open(me());
    await openAdd(box);
    await typeInto(inputByLabel(dialogOf(), "名称（可选）"), "新的");
    await typeInto(inputByLabel(dialogOf(), "当前密码"), "pw-current");
    await submitDialog();
    expect(server.callsTo("POST /api/me/passkeys/options")[0]?.body).toEqual({ password: "pw-current" });
    expect(webauthn.register).toHaveBeenCalledWith(OPTIONS);
    expect(server.callsTo("POST /api/me/passkeys/verify")[0]?.body).toEqual({ response: CREDENTIAL, name: "新的" });
  });

  it("{code}：已启用 2FA 的账号可改用验证码", async () => {
    const { box, server } = await open(me({ totp_enabled: true }));
    await openAdd(box);
    await click(byText(dialogOf(), "label", "验证码"));
    await typeInto(inputByLabel(dialogOf(), "验证码"), "123456");
    await submitDialog();
    expect(server.callsTo("POST /api/me/passkeys/options")[0]?.body).toEqual({ code: "123456" });
    expect(server.callsTo("POST /api/me/passkeys/verify")[0]?.body).toEqual({ response: CREDENTIAL });
  });

  it("{}：没有密码的账号凭最近登录，不需要输入", async () => {
    const { box, server } = await open(me({ has_password: false }));
    await openAdd(box);
    expect(dialogOf().textContent).toContain("你的账号没有密码");
    await submitDialog();
    expect(server.callsTo("POST /api/me/passkeys/options")[0]?.body).toEqual({});
  });

  it("再确认失败：不调用浏览器，错误显示在输入框下", async () => {
    const { box, server, webauthn } = await open(me());
    server.set("POST /api/me/passkeys/options", errorReply(400, "reauth_failed", "当前密码或验证码错误"));
    await openAdd(box);
    await typeInto(inputByLabel(dialogOf(), "当前密码"), "bad");
    await submitDialog();
    expect(webauthn.register).not.toHaveBeenCalled();
    expect(dialogOf().textContent).toContain("当前密码或验证码错误");
  });

  it("用户取消系统弹窗：说明可以重试，不调用 verify", async () => {
    const { box, server, webauthn } = await open(me());
    vi.mocked(webauthn.register).mockRejectedValueOnce(new DOMException("x", "NotAllowedError"));
    await openAdd(box);
    await typeInto(inputByLabel(dialogOf(), "当前密码"), "pw");
    await submitDialog();
    expect(dialogOf().textContent).toContain("已取消");
    expect(server.callsTo("POST /api/me/passkeys/verify")).toHaveLength(0);
  });
});

describe("改名与删除", () => {
  it("改名发 PATCH {name}", async () => {
    const { box, server } = await open(me());
    await click(byText(box.querySelectorAll<HTMLElement>(".item-list li")[0] as HTMLElement, "button", "改名"));
    const input = inputByLabel(dialogOf(), "名称");
    await typeInto(input, "工作笔记本");
    await submitDialog();
    expect(server.callsTo("PATCH /api/me/passkeys/7")[0]?.body).toEqual({ name: "工作笔记本" });
  });

  it("删除最后一种登录方式：409 last_login_method 给出说明", async () => {
    const { box, server } = await open(me());
    server.set("DELETE /api/me/passkeys/8", errorReply(409, "last_login_method", "至少需要保留一种登录方式"));
    await click(byText(box.querySelectorAll<HTMLElement>(".item-list li")[1] as HTMLElement, "button", "删除"));
    await click(byText(dialogOf(), "button", "删除"));
    await settle();
    expect(dialogOf().textContent).toContain("这是你唯一的登录方式");
    expect(dialogOf().textContent).toContain("last_login_method");
  });
});
