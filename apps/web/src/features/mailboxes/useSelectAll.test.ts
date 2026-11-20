// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminMailbox, AdminMailboxListQuery, AdminMailboxListResponse } from "@maillink/shared";
import { click, flush, mount } from "../../test/render";
import type { Mounted } from "../../test/render";
import { useSelectAll } from "./useSelectAll";
import type { Selection } from "./useMailboxSelection";

const listMailboxes = vi.fn<(query: AdminMailboxListQuery) => Promise<AdminMailboxListResponse>>();
vi.mock("../../api/instance", () => ({ api: { listMailboxes: (query: AdminMailboxListQuery) => listMailboxes(query) } }));

let mounted: Mounted | null = null;
beforeEach(() => {
  listMailboxes.mockReset();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

const box = (id: number): AdminMailbox => ({ id, address: `a${id}@x.com`, label: null, note: null, status: "active", tags: [], link_count: 0, grant_count: 0, last_received_at: null, created_at: 0, updated_at: 0 });

function pages(total: number, size: number) {
  listMailboxes.mockImplementation(async ({ cursor }) => {
    const start = cursor === undefined ? 0 : Number(cursor);
    const items = Array.from({ length: Math.min(size, total - start) }, (_, i) => box(start + i + 1));
    const next = start + size < total ? String(start + size) : null;
    return { items, next_cursor: next, total, active_count: total, disabled_count: 0 };
  });
}

function Harness({ selection }: { selection: Selection }) {
  const all = useSelectAll(selection, {});
  return createElement("div", null, createElement("button", { onClick: all.run }, "run"), createElement("output", null, all.error?.message ?? ""));
}

function selectionSpy() {
  return { selected: new Map(), toggle: vi.fn(), setMany: vi.fn(), replace: vi.fn(), clear: vi.fn() } satisfies Selection;
}

describe("选择全部", () => {
  it("总数不超过上限：逐页取完并整体选中", async () => {
    pages(250, 100);
    const selection = selectionSpy();
    mounted = await mount(createElement(Harness, { selection }));
    await click(mounted.container.querySelector("button") as Element);
    await flush(6);
    expect(listMailboxes).toHaveBeenCalledTimes(3);
    expect(selection.replace.mock.calls[0]?.[0]).toHaveLength(250);
  });

  it("超过 500 个：明确报错，不静默截断，也不改选择", async () => {
    pages(650, 100);
    const selection = selectionSpy();
    mounted = await mount(createElement(Harness, { selection }));
    await click(mounted.container.querySelector("button") as Element);
    await flush(10);
    expect(selection.replace).not.toHaveBeenCalled();
    expect(mounted.container.querySelector("output")?.textContent).toContain("筛选结果超过 500 个，请缩小范围");
  });
});
