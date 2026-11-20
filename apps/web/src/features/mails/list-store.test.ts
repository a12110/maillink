import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminMailListItem, AdminMailListResponse } from "@maillink/shared";
import { listItems, MailListStore, nextCursorOf } from "./list-store";

const DELAYS = [1000, 2000, 4000];

function item(id: number, parse_status: AdminMailListItem["parse_status"] = "ok"): AdminMailListItem {
  return { id, received_at: 1_700_000_000 + id, recipient: "a@b.c", envelope: null, sender: null, parse_status, subject: null, has_attachment: null, code: null, category: null };
}

function response(ids: number[], next: string | null, partial = false): AdminMailListResponse {
  return { items: ids.map((id) => item(id, partial && id === ids[0] ? "pending" : "ok")), next_cursor: next, partial };
}

/** 脚本化的后端：按调用顺序依次返回预置的响应或错误，并记录每次请求的游标 */
function scripted(steps: Array<AdminMailListResponse | Error>) {
  const cursors: Array<string | undefined> = [];
  const fetchPage = vi.fn(async (cursor: string | undefined) => {
    cursors.push(cursor);
    const step = steps.shift();
    if (step === undefined) throw new Error("脚本用尽：多发了一次请求");
    if (step instanceof Error) throw step;
    return step;
  });
  return { fetchPage, cursors };
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("MailListStore：游标分页", () => {
  it("首页 → 加载更多：用上一页的 next_cursor，追加在后面", async () => {
    const { fetchPage, cursors } = scripted([response([30, 29], "29"), response([28, 27], null)]);
    const store = new MailListStore(fetchPage, DELAYS);
    store.start();
    await flush();
    expect(listItems(store.getSnapshot()).map((i) => i.id)).toEqual([30, 29]);
    expect(nextCursorOf(store.getSnapshot())).toBe("29");
    store.loadMore();
    await flush();
    expect(listItems(store.getSnapshot()).map((i) => i.id)).toEqual([30, 29, 28, 27]);
    expect(nextCursorOf(store.getSnapshot())).toBeNull();
    expect(cursors).toEqual([undefined, "29"]);
  });

  it("换筛选重新 start：丢弃在途请求的旧结果", async () => {
    let release: (value: AdminMailListResponse) => void = () => {};
    const slow = new Promise<AdminMailListResponse>((resolve) => (release = resolve));
    const fetchPage = vi.fn().mockReturnValueOnce(slow).mockResolvedValueOnce(response([2], null));
    const store = new MailListStore(fetchPage, DELAYS);
    store.start();
    store.start();
    await flush();
    release(response([1], null));
    await flush();
    expect(listItems(store.getSnapshot()).map((i) => i.id)).toEqual([2]);
  });
});

describe("MailListStore：刷新", () => {
  it("refresh 保留旧列表，只在新结果到达后整体替换", async () => {
    let release: (value: AdminMailListResponse) => void = () => {};
    const slow = new Promise<AdminMailListResponse>((resolve) => (release = resolve));
    const fetchPage = vi.fn().mockResolvedValueOnce(response([2, 1], null)).mockReturnValueOnce(slow);
    const store = new MailListStore(fetchPage, DELAYS);
    store.start();
    await flush();
    store.refresh();
    expect(store.getSnapshot().busy).toBe("first");
    expect(listItems(store.getSnapshot()).map((i) => i.id)).toEqual([2, 1]);
    release(response([3, 2, 1], null));
    await flush();
    expect(listItems(store.getSnapshot()).map((i) => i.id)).toEqual([3, 2, 1]);
    expect(store.getSnapshot().busy).toBeNull();
  });

  it("refresh 失败：旧列表仍在，错误暴露，可重试", async () => {
    const { fetchPage } = scripted([response([1], null), new Error("down"), response([2, 1], null)]);
    const store = new MailListStore(fetchPage, DELAYS);
    store.start();
    await flush();
    store.refresh();
    await flush();
    expect(store.getSnapshot().hasError).toBe(true);
    expect(listItems(store.getSnapshot())).toHaveLength(1);
    store.retry();
    await flush();
    expect(listItems(store.getSnapshot())).toHaveLength(2);
  });
});

describe("MailListStore：partial 退避重取", () => {
  it("1s / 2s / 4s 重取同一个请求，期间不推进游标，成功后才允许加载更多", async () => {
    const { fetchPage, cursors } = scripted([
      response([30, 29], "29", true),
      response([30, 29], "29", true),
      response([30, 29], "29", true),
      response([30, 29], "29"),
      response([28], null),
    ]);
    const store = new MailListStore(fetchPage, DELAYS);
    store.start();
    await flush();

    // 首页 partial：保留已显示的内容，状态是“第 1 次”，不能翻页
    expect(listItems(store.getSnapshot())).toHaveLength(2);
    expect(store.getSnapshot().partial).toEqual({ attempt: 1, exhausted: false });
    expect(nextCursorOf(store.getSnapshot())).toBeNull();
    store.loadMore();
    expect(fetchPage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().partial).toEqual({ attempt: 2, exhausted: false });

    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot().partial).toEqual({ attempt: 3, exhausted: false });

    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchPage).toHaveBeenCalledTimes(4);
    expect(store.getSnapshot().partial).toBeNull();
    // 重取的每一次都是首页的同一个请求（cursor 仍是 undefined），没有用 next_cursor
    expect(cursors).toEqual([undefined, undefined, undefined, undefined]);
    // 重取成功后同一页被替换而不是追加
    expect(listItems(store.getSnapshot())).toHaveLength(2);
    expect(listItems(store.getSnapshot()).every((i) => i.parse_status === "ok")).toBe(true);

    store.loadMore();
    await flush();
    expect(cursors.at(-1)).toBe("29");
    expect(listItems(store.getSnapshot())).toHaveLength(3);
  });

  it("3 次仍不全：标记用尽、保留内容、不再自动重取；手动重试从头计数", async () => {
    const partialPage = () => response([5, 4], null, true);
    const { fetchPage } = scripted([partialPage(), partialPage(), partialPage(), partialPage(), response([5, 4], null)]);
    const store = new MailListStore(fetchPage, DELAYS);
    store.start();
    await flush();
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
    expect(fetchPage).toHaveBeenCalledTimes(4);
    expect(store.getSnapshot().partial).toEqual({ attempt: 3, exhausted: true });
    expect(listItems(store.getSnapshot())).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchPage).toHaveBeenCalledTimes(4);

    store.retry();
    await flush();
    expect(fetchPage).toHaveBeenCalledTimes(5);
    expect(store.getSnapshot().partial).toBeNull();
  });

  it("后面的页 partial：只重取那一页，前面的页保留", async () => {
    const { fetchPage, cursors } = scripted([response([30, 29], "29"), response([28, 27], null, true), response([28, 27], null)]);
    const store = new MailListStore(fetchPage, DELAYS);
    store.start();
    await flush();
    store.loadMore();
    await flush();
    expect(store.getSnapshot().partial?.attempt).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(cursors).toEqual([undefined, "29", "29"]);
    expect(listItems(store.getSnapshot()).map((i) => i.id)).toEqual([30, 29, 28, 27]);
    expect(store.getSnapshot().partial).toBeNull();
  });

  it("重取失败：保留已显示内容并暴露错误；重试后恢复", async () => {
    const boom = new Error("boom");
    const { fetchPage } = scripted([response([2, 1], null, true), boom, response([2, 1], null)]);
    const store = new MailListStore(fetchPage, DELAYS);
    store.start();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    const failed = store.getSnapshot();
    expect(failed.hasError).toBe(true);
    expect(failed.error).toBe(boom);
    expect(listItems(failed)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchPage).toHaveBeenCalledTimes(2);

    store.retry();
    await flush();
    expect(store.getSnapshot().hasError).toBe(false);
    expect(store.getSnapshot().partial).toBeNull();
  });

  it("首页就失败：没有内容、有错误；重试成功", async () => {
    const { fetchPage } = scripted([new Error("down"), response([1], null)]);
    const store = new MailListStore(fetchPage, DELAYS);
    store.start();
    await flush();
    expect(store.getSnapshot().pages).toHaveLength(0);
    expect(store.getSnapshot().hasError).toBe(true);
    store.retry();
    await flush();
    expect(listItems(store.getSnapshot()).map((i) => i.id)).toEqual([1]);
  });

  it("dispose 取消待执行的重取", async () => {
    const { fetchPage } = scripted([response([1], null, true)]);
    const store = new MailListStore(fetchPage, DELAYS);
    store.start();
    await flush();
    store.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
