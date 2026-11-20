// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminUser } from "@maillink/shared";
import { settle } from "../../test/dom";
import { errorReply, installFakeFetch } from "../../test/fake-fetch";
import { mountWithProviders } from "../../test/providers";
import { click } from "../../test/render";
import type { Mounted } from "../../test/render";
import { UsersPage } from "./UsersPage";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const user = (id: number): AdminUser => ({
  id, username: `user${id}`, display_name: null, email: null, role: "user", status: "active", created_at: 1, last_login_at: null,
  login_methods: { password: true, totp: false, passkey_count: 0, oauth_providers: [] },
  mailbox_grant_count: 0,
});

const summary = (container: HTMLElement) => container.querySelector(".summary")?.textContent ?? null;

describe("用户页页头：共 N 个用户", () => {
  it("显示列表响应里的 total（不是本页条数），翻页后不变", async () => {
    const server = installFakeFetch({
      "GET /api/admin/users": (call) =>
        call.url.includes("cursor=2")
          ? { json: { items: [user(1)], next_cursor: null, total: 57 } }
          : { json: { items: [user(3), user(2)], next_cursor: "2", total: 57 } },
    });
    mounted = await mountWithProviders(createElement(UsersPage));
    await settle();
    expect(summary(mounted.container)).toBe("共 57 个用户");

    await click(mounted.container.querySelector<HTMLButtonElement>('button[aria-label="下一页"]') as HTMLButtonElement);
    await settle();
    expect(server.callsTo("GET /api/admin/users")).toHaveLength(2);
    expect(summary(mounted.container)).toBe("共 57 个用户");
  });

  it("加载中不显示；加载失败不显示（不会出现 0）", async () => {
    installFakeFetch({ "GET /api/admin/users": errorReply(500, "internal_error", "boom") });
    mounted = await mountWithProviders(createElement(UsersPage));
    expect(summary(mounted.container)).toBeNull();
    await settle();
    expect(mounted.container.textContent).toContain("internal_error");
    expect(summary(mounted.container)).toBeNull();
    expect(mounted.container.textContent).not.toContain("共 0 个用户");
  });
});
