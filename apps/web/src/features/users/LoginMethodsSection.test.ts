// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminUserDetail } from "@maillink/shared";
import { byText, settle } from "../../test/dom";
import { installFakeFetch } from "../../test/fake-fetch";
import { mountWithProviders } from "../../test/providers";
import { click } from "../../test/render";
import type { Mounted } from "../../test/render";
import { LoginMethodsSection } from "./LoginMethodsSection";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const USER: AdminUserDetail = {
  id: 5, username: "bob", display_name: null, email: null, role: "user", status: "active", created_at: 1, last_login_at: null,
  login_methods: { password: false, totp: true, passkey_count: 2, oauth_providers: ["github"] },
  mailbox_grant_count: 0,
  passkeys: [
    { id: 3, name: "YubiKey", transports: ["usb"], created_at: 1, last_used_at: null },
    { id: 4, name: "MacBook", transports: ["internal"], created_at: 1, last_used_at: 1_700_000_000 },
  ],
  identities: [{ id: 8, provider: { slug: "github", name: "GitHub", icon: null }, email: "bob@example.com", display_name: null, created_at: 1, last_login_at: null }],
};

const removal = (overrides: Partial<{ removed: number; no_login_method: boolean }> = {}) => ({
  json: { status: "ok", removed: 1, sessions_revoked: 3, no_login_method: false, ...overrides },
});

async function open(user: AdminUserDetail = USER) {
  const server = installFakeFetch({
    "GET /api/auth/session": { json: { user: { id: 1, username: "root", display_name: null, email: null, role: "admin" }, auth_methods: ["password"], expires_at: 2_000_000_000 } },
    "DELETE /api/admin/users/5/totp": removal(),
    "DELETE /api/admin/users/5/passkeys": removal({ removed: 2 }),
    "DELETE /api/admin/users/5/passkeys/3": removal(),
    "DELETE /api/admin/users/5/identities": removal(),
    "DELETE /api/admin/users/5/identities/8": removal({ no_login_method: true }),
    "POST /api/admin/users/5/password": { json: { status: "ok" } },
  });
  mounted = await mountWithProviders(createElement(LoginMethodsSection, { user }));
  await settle();
  return { box: mounted.container, server };
}

function alertDialog(): HTMLElement {
  const dialog = document.body.querySelector<HTMLElement>("[role=alertdialog]");
  if (!dialog) throw new Error("没有弹出确认框");
  return dialog;
}

async function confirm(label: string): Promise<void> {
  await click(byText(alertDialog(), "button", label));
  await settle();
}

describe("用户侧板：登录方式的清除", () => {
  it("列出每项登录方式及各自的清除按钮", async () => {
    const { box } = await open();
    expect(box.textContent).toContain("两步验证：已启用");
    expect(box.textContent).toContain("YubiKey");
    expect(box.textContent).toContain("GitHub · bob@example.com");
    for (const label of ["清除", "全部删除", "全部解除"]) expect(byText(box, "button", label)).toBeTruthy();
  });

  it("清除两步验证：二次确认写明后果，确认后调用 DELETE /totp", async () => {
    const { box, server } = await open();
    await click(byText(box, "button", "清除"));
    expect(alertDialog().textContent).toContain("恢复码");
    expect(alertDialog().textContent).toContain("全部会话会随之失效");
    expect(server.callsTo("DELETE /api/admin/users/5/totp")).toHaveLength(0);
    await confirm("清除两步验证");
    expect(server.callsTo("DELETE /api/admin/users/5/totp")).toHaveLength(1);
  });

  it("取消确认框不发请求", async () => {
    const { box, server } = await open();
    await click(byText(box, "button", "清除"));
    await click(byText(alertDialog(), "button", "取消"));
    await settle();
    expect(server.calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
  });

  it("通行密钥：单把走 /passkeys/:pid，全部走 /passkeys", async () => {
    const { box, server } = await open();
    const yubi = byText(box, ".method-sub li", /YubiKey/);
    await click(byText(yubi, "button", "删除"));
    await confirm("确认清除");
    expect(server.callsTo("DELETE /api/admin/users/5/passkeys/3")).toHaveLength(1);

    await click(byText(box, "button", "全部删除"));
    await confirm("全部清除");
    expect(server.callsTo("DELETE /api/admin/users/5/passkeys")).toHaveLength(1);
  });

  it("no_login_method：提示为其设置密码并给出“重置密码”入口", async () => {
    const { box, server } = await open();
    await click(byText(byText(box, ".method-sub li", /GitHub/), "button", "解除"));
    await confirm("确认清除");
    expect(server.callsTo("DELETE /api/admin/users/5/identities/8")).toHaveLength(1);
    expect(box.textContent).toContain("该用户已没有可用的登录方式，请为其设置密码");

    await click(byText(box.querySelector(".callout") as HTMLElement, "button", "重置密码"));
    await settle();
    expect(document.body.textContent).toContain("重置 bob 的密码");
  });

  it("清除自己的凭据后刷新会话（admin_2fa_required 可能变化）；清别人的不刷新", async () => {
    const self: AdminUserDetail = { ...USER, id: 1, username: "root" };
    const { box, server } = await open(self);
    server.set("DELETE /api/admin/users/1/totp", removal());
    const before = server.callsTo("GET /api/auth/session").length;
    await click(byText(box, "button", "清除"));
    await confirm("清除两步验证");
    expect(server.callsTo("GET /api/auth/session").length).toBe(before + 1);
  });

  it("不是最后一种登录方式时不提示", async () => {
    const { box } = await open();
    await click(byText(box, "button", "清除"));
    await confirm("清除两步验证");
    expect(box.textContent).not.toContain("该用户已没有可用的登录方式");
  });
});
