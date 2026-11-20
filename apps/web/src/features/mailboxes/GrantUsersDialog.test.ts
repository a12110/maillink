// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminMailbox } from "@maillink/shared";
import { byText, settle } from "../../test/dom";
import { installFakeFetch } from "../../test/fake-fetch";
import { mountWithProviders } from "../../test/providers";
import { click } from "../../test/render";
import type { Mounted } from "../../test/render";
import { buildMultiGrantRequest, describeGrantResults } from "./grant-batch";
import { GrantUsersDialog } from "./GrantUsersDialog";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const NOW = 1_800_000_000;
const box = (id: number, address: string, status: AdminMailbox["status"] = "active"): AdminMailbox => ({
  id, address, label: null, note: null, status, tags: [], link_count: 0, grant_count: 0, last_received_at: null, created_at: 1, updated_at: 1,
});
const user = (id: number, username: string) => ({
  id, username, display_name: null, email: null, role: "user", status: "active", created_at: 1, last_login_at: null,
  login_methods: { password: true, totp: false, passkey_count: 0, oauth_providers: [] }, mailbox_grant_count: 0,
});

describe("授权给用户：请求体", () => {
  const values = { userIds: [1, 2], mailboxIds: [10, 11], ruleGroupId: null, expiresLocal: "", onConflict: "skip" as const };

  it("rule_group_id 显式 null（完整访问）、过期 null、跳过已有", () => {
    expect(buildMultiGrantRequest(values, NOW)).toEqual({
      ok: true,
      value: { user_ids: [1, 2], mailbox_ids: [10, 11], rule_group_id: null, expires_at: null, on_conflict: "skip" },
    });
  });

  it("没选用户 / 地址、过期时间不在未来、对数超过上限 → 就地错误", () => {
    expect(buildMultiGrantRequest({ ...values, userIds: [] }, NOW)).toMatchObject({ ok: false, error: "请至少选择一个用户" });
    expect(buildMultiGrantRequest({ ...values, mailboxIds: [] }, NOW)).toMatchObject({ ok: false });
    expect(buildMultiGrantRequest({ ...values, expiresLocal: "2001-01-01T00:00" }, NOW)).toMatchObject({ ok: false, error: expect.stringContaining("晚于现在") });
    const manyUsers = Array.from({ length: 3 }, (_, i) => i + 1);
    const manyBoxes = Array.from({ length: 400 }, (_, i) => i + 1);
    expect(buildMultiGrantRequest({ ...values, userIds: manyUsers, mailboxIds: manyBoxes }, NOW)).toMatchObject({ ok: false, error: expect.stringContaining("1000") });
  });

  it("逐条结果：状态与原因中文化，找不到名字显示 #id", () => {
    const rows = describeGrantResults(
      {
        summary: { created: 1, updated: 0, skipped: 1, failed: 1 },
        results: [
          { user_id: 1, mailbox_id: 10, status: "created", reason: null, grant_id: 5 },
          { user_id: 1, mailbox_id: 11, status: "skipped", reason: "already_exists", grant_id: 6 },
          { user_id: 9, mailbox_id: 12, status: "failed", reason: "user_not_found", grant_id: null },
        ],
      },
      new Map([[1, "bob"]]),
      new Map([[10, "a@x.com"], [11, "b@x.com"]]),
    );
    expect(rows.map((row) => [row.who, row.label, row.note])).toEqual([
      ["bob × a@x.com", "已授权", ""],
      ["bob × b@x.com", "已跳过", "已有授权，按“跳过”保持不动"],
      ["#9 × #12", "失败", "用户不存在"],
    ]);
  });
});

describe("授权给用户：对话框", () => {
  const selected = new Map([[10, box(10, "a@x.com")], [11, box(11, "b@x.com", "disabled")]]);

  async function open() {
    const server = installFakeFetch({
      "GET /api/admin/users": { json: { items: [user(7, "bob"), user(8, "carol")], next_cursor: null, total: 2 } },
      "GET /api/admin/rule-groups": { json: { items: [], next_cursor: null } },
      "POST /api/admin/grants/batch": {
        json: {
          summary: { created: 1, updated: 0, skipped: 1, failed: 0 },
          results: [
            { user_id: 7, mailbox_id: 10, status: "created", reason: null, grant_id: 1 },
            { user_id: 7, mailbox_id: 11, status: "skipped", reason: "already_exists", grant_id: 2 },
          ],
        },
      },
    });
    mounted = await mountWithProviders(createElement(GrantUsersDialog, { mailboxes: selected, onClose: vi.fn() }));
    await settle();
    return server;
  }
  const dialog = () => document.body.querySelector<HTMLElement>("[role=dialog]") as HTMLElement;

  it("选用户 → 提交：POST /api/admin/grants/batch，显示逐条结果；已停用地址有提示", async () => {
    const server = await open();
    expect(dialog().textContent).toContain("授权 2 个地址给用户");
    expect(dialog().textContent).toContain("选中的地址里有 1 个已停用");
    expect(server.callsTo("GET /api/admin/users")[0]?.url).toContain("role=user");
    const boxes = Array.from(dialog().querySelectorAll<HTMLInputElement>(".picker-list input[type=checkbox]"));
    expect(boxes).toHaveLength(2);
    await click(boxes[0] as HTMLInputElement);
    expect(dialog().textContent).toContain("已选 1 个");
    await click(byText(dialog(), "button", "授权 1 个用户"));
    await settle();
    expect(server.callsTo("POST /api/admin/grants/batch")[0]?.body).toEqual({ user_ids: [7], mailbox_ids: [10, 11], rule_group_id: null, expires_at: null, on_conflict: "skip" });
    const rows = Array.from(dialog().querySelectorAll(".grant-results li")).map((li) => li.textContent);
    expect(rows).toEqual(["已授权bob × a@x.com", "已跳过bob × b@x.com已有授权，按“跳过”保持不动"]);
    expect(dialog().textContent).toContain("新增 1，更新 0，跳过 1");
  });

  it("没选用户就提交：就地提示，不发请求", async () => {
    const server = await open();
    await click(byText(dialog(), "button", "授权 0 个用户"));
    expect(dialog().textContent).toContain("请至少选择一个用户");
    expect(server.callsTo("POST /api/admin/grants/batch")).toHaveLength(0);
  });
});
