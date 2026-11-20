// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type * as ReactRouter from "@tanstack/react-router";
import type { AdminMailbox } from "@maillink/shared";
import { click, mount } from "../../test/render";
import type { Mounted } from "../../test/render";
import { MailboxTable } from "./MailboxTable";
import type { Selection } from "./useMailboxSelection";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  const { createElement: h } = await import("react");
  const Link = ({ to, search, children, ...rest }: { to: string; search?: unknown; children?: unknown }) =>
    h("a", { href: to, "data-search": JSON.stringify(search ?? null), ...rest }, children as never);
  return { ...actual, Link };
});

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

const box = (id: number, over: Partial<AdminMailbox> = {}): AdminMailbox => ({
  id, address: `a${id}@icloud.com`, label: null, note: `备注 ${id}`, status: "active", tags: ["OpenAI", "共享"], link_count: 2, grant_count: 0, last_received_at: null, created_at: 0, updated_at: 0, ...over,
});

type SpySelection = Selection & { setMany: Mock<Selection["setMany"]>; toggle: Mock<Selection["toggle"]> };

function selectionOf(selected: AdminMailbox[]): SpySelection {
  return {
    selected: new Map(selected.map((m) => [m.id, m])),
    toggle: vi.fn<Selection["toggle"]>(),
    setMany: vi.fn<Selection["setMany"]>(),
    replace: vi.fn<Selection["replace"]>(),
    clear: vi.fn<Selection["clear"]>(),
  };
}

function table(items: AdminMailbox[] | undefined, selection: Selection, over: Record<string, unknown> = {}) {
  return createElement(MailboxTable, {
    items, total: items?.length, loading: false, error: null, filtered: false, page: 1, pageSize: 16, hasNext: false, selection,
    onEdit: vi.fn(), onPage: vi.fn(), onRetry: vi.fn(), onClearFilters: vi.fn(), onImport: vi.fn(), ...over,
  });
}

describe("收件地址表", () => {
  it("行内操作只有真正存在的入口：该地址的邮件（带 to_address 筛选）与编辑；链接数 / 授权数是普通数字，不渲染假入口", async () => {
    mounted = await mount(table([box(1)], selectionOf([])));
    const actions = mounted.container.querySelector(".row-actions");
    const link = actions?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/admin/mails");
    expect(JSON.parse(link?.getAttribute("data-search") ?? "null")).toEqual({ to_address: "a1@icloud.com" });
    expect(link?.getAttribute("aria-label")).toBe("查看 a1@icloud.com 的邮件");
    expect(actions?.querySelectorAll("a, button")).toHaveLength(2);
    expect(mounted.container.querySelectorAll(".col-num a")).toHaveLength(0);
    expect(Array.from(mounted.container.querySelectorAll(".col-num")).map((c) => c.textContent)).toContain("2");
  });

  it("勾选行与“选择当前页全部”；已选行高亮；部分选中时表头是半选", async () => {
    const items = [box(1), box(2)];
    const selection = selectionOf([items[0] as AdminMailbox]);
    mounted = await mount(table(items, selection));
    const rows = Array.from(mounted.container.querySelectorAll("tbody tr"));
    expect(rows[0]?.getAttribute("data-selected")).toBe("true");
    expect(rows[1]?.getAttribute("data-selected")).toBe("false");
    const head = mounted.container.querySelector<HTMLInputElement>("thead input[type=checkbox]");
    expect(head?.indeterminate).toBe(true);
    expect(head?.checked).toBe(false);
    await click(mounted.container.querySelectorAll<HTMLInputElement>("tbody input[type=checkbox]")[1] as HTMLInputElement);
    expect(selection.toggle).toHaveBeenCalledWith(items[1], true);
    if (head) await click(head);
    expect(selection.setMany).toHaveBeenCalledWith(items, true);
  });

  it("状态、标签溢出、从未来信都有文字（不只靠颜色）", async () => {
    const many = box(1, { tags: ["a", "b", "c", "d", "e"], status: "disabled", note: null });
    mounted = await mount(table([many], selectionOf([])));
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("已停用");
    expect(text).toContain("+2");
    expect(text).toContain("从未来信");
  });

  it("三态：加载（骨架）、空（首次 / 筛选无结果分开写）、出错（带错误码与重试）", async () => {
    mounted = await mount(table(undefined, selectionOf([])));
    expect(mounted.container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    await mounted.render(table([], selectionOf([])));
    expect(mounted.container.textContent).toContain("还没有收件地址");
    await mounted.render(table([], selectionOf([]), { filtered: true }));
    expect(mounted.container.textContent).toContain("没有符合筛选的地址");
    const onRetry = vi.fn();
    await mounted.render(table(undefined, selectionOf([]), { error: { message: "无法连接服务器", detail: "network_error" }, onRetry }));
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toContain("network_error");
    const retry = Array.from(mounted.container.querySelectorAll("button")).find((b) => b.textContent === "重试");
    if (retry) await click(retry);
    expect(onRetry).toHaveBeenCalled();
  });
});
