// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@maillink/shared";
import { byText, inputByLabel, settle, submit } from "../../test/dom";
import { errorReply, installFakeFetch } from "../../test/fake-fetch";
import { makePublicConfig } from "../../test/fixtures";
import { mountWithProviders } from "../../test/providers";
import { click, typeInto } from "../../test/render";
import type { Mounted } from "../../test/render";
import { IdentitiesSection } from "./IdentitiesSection";

// FIN-A：绑定第三方账号改为 再确认 → POST /api/auth/oauth/:slug/link → 拿 authorize_url 整页跳转；不再有 GET 发起的链接。

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const LINK = "POST /api/auth/oauth/github/link";
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize?client_id=c&state=abc";
const CONFIG = makePublicConfig({ login_methods: ["password", "oauth"], oauth_providers: [{ slug: "github", name: "GitHub", icon: null }] });

function me(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: 1, username: "alice", display_name: null, email: null, role: "user", has_password: true,
    totp_enabled: false, recovery_codes_remaining: 0, created_at: 1, last_login_at: null, ...overrides,
  };
}

async function open(user: MeResponse) {
  const server = installFakeFetch({
    "GET /api/public/config": { json: CONFIG },
    "GET /api/me/identities": { json: { items: [] } },
    [LINK]: { json: { authorize_url: AUTHORIZE_URL } },
  });
  const redirect = vi.fn();
  mounted = await mountWithProviders(createElement(IdentitiesSection, { me: user, redirect }));
  await settle();
  return { box: mounted.container, server, redirect };
}

function dialogOf(): HTMLElement {
  const dialog = document.body.querySelector<HTMLElement>("[role=dialog]");
  if (!dialog) throw new Error("没有弹出对话框");
  return dialog;
}

async function submitDialog(): Promise<void> {
  const form = dialogOf().querySelector("form");
  if (!form) throw new Error("对话框里没有表单");
  await submit(form);
  await settle();
}

describe("绑定第三方账号", () => {
  it("没有 GET 发起绑定的链接；点“绑定”先弹再确认，不直接发请求", async () => {
    const { box, server } = await open(me());
    expect(box.querySelector("a[href*='/api/auth/oauth/']")).toBeNull();
    await click(byText(box, "button", "绑定 GitHub"));
    expect(dialogOf().textContent).toContain("绑定 GitHub");
    expect(server.callsTo(LINK)).toHaveLength(0);
  });

  it("输入当前密码 → POST {password} → 用返回的 authorize_url 整页跳转", async () => {
    const { box, server, redirect } = await open(me());
    await click(byText(box, "button", "绑定 GitHub"));
    await typeInto(inputByLabel(dialogOf(), "当前密码"), "pw-current");
    await submitDialog();
    expect(server.callsTo(LINK).map((call) => call.body)).toEqual([{ password: "pw-current" }]);
    expect(redirect).toHaveBeenCalledWith(AUTHORIZE_URL);
  });

  it("没有密码的账号凭最近登录：不需要输入，POST {}", async () => {
    const { box, server, redirect } = await open(me({ has_password: false }));
    await click(byText(box, "button", "绑定 GitHub"));
    expect(dialogOf().textContent).toContain("你的账号没有密码");
    await submitDialog();
    expect(server.callsTo(LINK)[0]?.body).toEqual({});
    expect(redirect).toHaveBeenCalledWith(AUTHORIZE_URL);
  });

  it("再确认失败：错误显示在输入框下，不跳转", async () => {
    const { box, server, redirect } = await open(me());
    server.set(LINK, errorReply(400, "reauth_failed", "当前密码或验证码错误"));
    await click(byText(box, "button", "绑定 GitHub"));
    await typeInto(inputByLabel(dialogOf(), "当前密码"), "bad");
    await submitDialog();
    expect(dialogOf().textContent).toContain("当前密码或验证码错误");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("其他错误（提供方已停用）就地显示在对话框里，不跳转", async () => {
    const { box, server, redirect } = await open(me());
    server.set(LINK, errorReply(404, "provider_unavailable", "这个第三方登录方式不存在或已停用"));
    await click(byText(box, "button", "绑定 GitHub"));
    await typeInto(inputByLabel(dialogOf(), "当前密码"), "pw-current");
    await submitDialog();
    expect(dialogOf().querySelector(".callout")?.textContent).toContain("这个第三方登录方式不存在或已停用");
    expect(redirect).not.toHaveBeenCalled();
  });
});
