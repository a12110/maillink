// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminGrant, AdminUserDetail } from "@maillink/shared";
import { byText, inputByLabel, settle, submit } from "../../test/dom";
import { installFakeFetch } from "../../test/fake-fetch";
import { mountWithProviders } from "../../test/providers";
import { click, typeInto } from "../../test/render";
import type { Mounted } from "../../test/render";
import { GrantsSection } from "./GrantsSection";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const USER: AdminUserDetail = {
  id: 5, username: "bob", display_name: null, email: null, role: "user", status: "active", created_at: 1, last_login_at: null,
  login_methods: { password: true, totp: false, passkey_count: 0, oauth_providers: [] },
  mailbox_grant_count: 2, passkeys: [], identities: [],
};

const GRANTS: AdminGrant[] = [
  { id: 11, user_id: 5, username: "bob", mailbox_id: 1, address: "a@x.com", mailbox_status: "active", rule_group_id: 2, rule_group_name: "只看验证码",
    expires_at: null, expired: false, effective: true, first_access_at: 1_700_000_000, created_at: 1 },
  { id: 12, user_id: 5, username: "bob", mailbox_id: 2, address: "b@x.com", mailbox_status: "active", rule_group_id: null, rule_group_name: null,
    expires_at: 1_600_000_000, expired: true, effective: false, first_access_at: null, created_at: 1 },
];

const MAILBOX = (id: number, address: string) => ({
  id, address, label: null, note: null, status: "active", tags: [], link_count: 0, grant_count: 0, last_received_at: null, created_at: 1, updated_at: 1,
});

async function open() {
  const server = installFakeFetch({
    "GET /api/admin/grants": { json: { items: GRANTS, next_cursor: null } },
    "GET /api/admin/mailboxes": { json: { items: [MAILBOX(1, "a@x.com"), MAILBOX(3, "c@x.com"), MAILBOX(4, "d@x.com")], next_cursor: null, total: 3, active_count: 3, disabled_count: 0 } },
    "GET /api/admin/rule-groups": {
      json: {
        items: [
          { id: 2, name: "只看验证码", description: null, schema_version: 1, revision: 1, invalid: false, invalid_code: null, view: "code_only", link_count: 0, grant_count: 1, created_at: 1, updated_at: 1 },
          { id: 3, name: "坏掉的", description: null, schema_version: 1, revision: 1, invalid: true, invalid_code: "x", view: null, link_count: 0, grant_count: 0, created_at: 1, updated_at: 1 },
        ],
        next_cursor: null,
      },
    },
    "POST /api/admin/grants/batch": {
      json: {
        summary: { created: 2, updated: 0, skipped: 0, failed: 0 },
        results: [
          { user_id: 5, mailbox_id: 3, status: "created", reason: null, grant_id: 21 },
          { user_id: 5, mailbox_id: 4, status: "created", reason: null, grant_id: 22 },
        ],
      },
    },
    "DELETE /api/admin/grants/12": { json: { status: "ok" } },
  });
  mounted = await mountWithProviders(createElement(GrantsSection, { user: USER }));
  await settle();
  return { box: mounted.container, server };
}

function dialogOf(): HTMLElement {
  const dialog = document.body.querySelector<HTMLElement>("[role=dialog], [role=alertdialog]");
  if (!dialog) throw new Error("没有弹出对话框");
  return dialog;
}

describe("授权块：列表", () => {
  it("请求 GET /api/admin/grants?user_id=；显示地址、规则组、过期、首次访问、是否有效；计数标注含失效", async () => {
    const { box, server } = await open();
    expect(server.callsTo("GET /api/admin/grants")[0]?.url).toBe("/api/admin/grants?user_id=5");
    const rows = Array.from(box.querySelectorAll(".grant-list > li")).map((li) => li.textContent ?? "");
    expect(rows[0]).toContain("a@x.com");
    expect(rows[0]).toContain("规则组：只看验证码");
    expect(rows[0]).toContain("不过期");
    expect(rows[0]).toContain("有效");
    expect(rows[1]).toContain("规则组：完整访问");
    expect(rows[1]).toContain("已过期");
    expect(rows[1]).toContain("首次访问：还没有");
    expect(box.textContent).toContain("共 2 个（含失效）");
  });

  it("删除授权：二次确认，调用 DELETE /api/admin/grants/:id", async () => {
    const { box, server } = await open();
    await click(byText(box.querySelectorAll<HTMLElement>(".grant-list > li")[1] as HTMLElement, "button", "删除"));
    expect(dialogOf().textContent).toContain("立刻看不到");
    await click(byText(dialogOf(), "button", "收回授权"));
    await settle();
    expect(server.callsTo("DELETE /api/admin/grants/12")).toHaveLength(1);
  });
});

describe("授权块：批量添加", () => {
  it("多选收件地址 + 规则组 + 过期时间 + 覆盖已有 → POST /api/admin/grants/batch", async () => {
    const { box, server } = await open();
    await click(byText(box, "button", "添加授权"));
    await settle();
    const dialog = dialogOf();
    const boxes = Array.from(dialog.querySelectorAll<HTMLInputElement>(".picker-list input[type=checkbox]"));
    expect(boxes).toHaveLength(3);
    await click(boxes[1] as HTMLInputElement);
    await click(boxes[2] as HTMLInputElement);
    expect(dialog.textContent).toContain("已选 2 个");

    const select = dialog.querySelector<HTMLSelectElement>("select");
    expect(select?.textContent).toContain("完整访问");
    expect(Array.from(select?.options ?? []).find((o) => o.textContent?.includes("坏掉的"))?.disabled).toBe(true);
    if (!select) throw new Error("没有规则组下拉");
    await act(async () => {
      select.value = "2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(byText(dialog, "label", "覆盖已有授权"));
    await typeInto(inputByLabel(dialog, "过期时间（可选）"), "2099-01-01T08:00");
    await submit(dialog.querySelector("form") as HTMLFormElement);
    await settle();

    const body = server.callsTo("POST /api/admin/grants/batch")[0]?.body as Record<string, unknown> | undefined;
    expect(body).toBeDefined();
    expect(body).toMatchObject({ user_ids: [5], mailbox_ids: [3, 4], rule_group_id: 2, on_conflict: "update" });
    expect(typeof body?.expires_at).toBe("number");
    expect(dialog.textContent).toContain("新增 2，更新 0，跳过 0");
  });

  it("没选收件地址：不发请求并提示", async () => {
    const { box, server } = await open();
    await click(byText(box, "button", "添加授权"));
    await settle();
    await submit(dialogOf().querySelector("form") as HTMLFormElement);
    await settle();
    expect(dialogOf().textContent).toContain("请至少选择一个收件地址");
    expect(server.callsTo("POST /api/admin/grants/batch")).toHaveLength(0);
  });
});
