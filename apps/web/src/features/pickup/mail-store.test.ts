import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentedMail, VisibleMailListResponse } from "@maillink/shared";
import { mergeMails, PickupMailStore } from "./mail-store";
import { PickupError } from "./pickup-api";
import type { MailsQuery } from "./pickup-api";

const DELAYS = [1000, 2000, 4000];
const INTERVAL_SEC = 10;

function mail(id: number, extra: Partial<PresentedMail> = {}): PresentedMail {
  return { id, received_at: 1_700_000_000 + id, code: String(100_000 + id), ...extra };
}

function page(ids: number[], nextAfter: number | null, options: { partial?: boolean; cursor?: string | null } = {}): VisibleMailListResponse {
  return { items: ids.map((id) => mail(id)), next_cursor: options.cursor ?? null, partial: options.partial ?? false, next_after_id: nextAfter };
}

/** 脚本化后端：按调用顺序返回预置响应或错误，并记录每次请求的参数 */
function scripted(steps: Array<VisibleMailListResponse | Error>) {
  const queries: MailsQuery[] = [];
  const fetchMails = vi.fn(async (query: MailsQuery) => {
    queries.push(query);
    const step = steps.shift();
    if (step === undefined) throw new Error("脚本用尽：多发了一次请求");
    if (step instanceof Error) throw step;
    return step;
  });
  return { fetchMails, queries };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("PickupMailStore：增量轮询", () => {
  it("首页之后用 after_id 增量轮询，间隔取 poll_interval_sec；新邮件合并在最前并给出 arrival", async () => {
    const { fetchMails, queries } = scripted([page([2, 1], 2), page([3], 3)]);
    const store = new PickupMailStore(fetchMails, DELAYS, INTERVAL_SEC);
    store.start();
    await flush();
    expect(store.getSnapshot().items.map((m) => m.id)).toEqual([2, 1]);
    expect(store.getSnapshot().arrival).toBeNull();
    await vi.advanceTimersByTimeAsync(INTERVAL_SEC * 1000 - 1);
    expect(fetchMails).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(queries).toEqual([{}, { after_id: 2 }]);
    expect(store.getSnapshot().items.map((m) => m.id)).toEqual([3, 2, 1]);
    expect(store.getSnapshot().arrival?.mails.map((m) => m.id)).toEqual([3]);
    store.dispose();
  });

  it("partial=true：after_id 只取 next_after_id，不用本批最大 id 推进；1s 后重取同一请求", async () => {
    // 增量响应里 id=9 已就绪，id=8 还没解析好：next_after_id 停在 7，不能推进到 9
    const { fetchMails, queries } = scripted([page([7], 7), page([9], 7, { partial: true }), page([9, 8], 9)]);
    const store = new PickupMailStore(fetchMails, DELAYS, INTERVAL_SEC);
    store.start();
    await flush();
    await vi.advanceTimersByTimeAsync(INTERVAL_SEC * 1000);
    expect(store.getSnapshot().afterId).toBe(7);
    expect(store.getSnapshot().partial).toEqual({ attempt: 1, exhausted: false });
    expect(store.getSnapshot().items.map((m) => m.id)).toEqual([9, 7]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(queries[2]).toEqual({ after_id: 7 });
    expect(store.getSnapshot().partial).toBeNull();
    expect(store.getSnapshot().afterId).toBe(9);
    expect(store.getSnapshot().items.map((m) => m.id)).toEqual([9, 8, 7]);
    store.dispose();
  });

  it("partial 退避 1s / 2s / 4s，3 次仍不全标记 exhausted，之后按正常间隔继续轮询，成功后清除", async () => {
    const partial = page([5], 4, { partial: true });
    const { fetchMails } = scripted([partial, partial, partial, partial, page([5, 6], 6)]);
    const store = new PickupMailStore(fetchMails, DELAYS, INTERVAL_SEC);
    store.start();
    await flush();
    expect(store.getSnapshot().partial).toEqual({ attempt: 1, exhausted: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().partial).toEqual({ attempt: 2, exhausted: false });
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getSnapshot().partial).toEqual({ attempt: 3, exhausted: false });
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchMails).toHaveBeenCalledTimes(4);
    expect(store.getSnapshot().partial).toEqual({ attempt: 3, exhausted: true });
    expect(store.getSnapshot().items.map((m) => m.id)).toEqual([5]);
    await vi.advanceTimersByTimeAsync(INTERVAL_SEC * 1000);
    expect(store.getSnapshot().partial).toBeNull();
    expect(store.getSnapshot().items.map((m) => m.id)).toEqual([6, 5]);
    store.dispose();
  });

  it("首页 partial 的重取不算新邮件到达", async () => {
    const { fetchMails } = scripted([page([1], 1, { partial: true }), page([2, 1], 2)]);
    const store = new PickupMailStore(fetchMails, DELAYS, INTERVAL_SEC);
    store.start();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().items.map((m) => m.id)).toEqual([2, 1]);
    expect(store.getSnapshot().arrival).toBeNull();
    store.dispose();
  });
});

describe("PickupMailStore：暂停与停止", () => {
  it("无操作暂停后不再轮询，手动恢复后立即刷新；暂停期间 refresh 不动", async () => {
    const { fetchMails } = scripted([page([1], 1), page([2], 2)]);
    const store = new PickupMailStore(fetchMails, DELAYS, INTERVAL_SEC);
    store.start();
    await flush();
    store.setIdle(true);
    store.refresh();
    await vi.advanceTimersByTimeAsync(INTERVAL_SEC * 5000);
    expect(fetchMails).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().paused).toBe("idle");
    store.setIdle(false);
    await flush();
    expect(fetchMails).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().paused).toBeNull();
    store.dispose();
  });

  it("stop('quota')：停止轮询，已显示的邮件保留", async () => {
    const { fetchMails } = scripted([page([2, 1], 2)]);
    const store = new PickupMailStore(fetchMails, DELAYS, INTERVAL_SEC);
    store.start();
    await flush();
    store.stop("quota");
    await vi.advanceTimersByTimeAsync(INTERVAL_SEC * 5000);
    expect(fetchMails).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().stopped).toBe("quota");
    expect(store.getSnapshot().items.map((m) => m.id)).toEqual([2, 1]);
  });

  it("轮询遇到 410：停止并保留已显示的内容；遇到 401：标记需要重新开始", async () => {
    const gone = new PickupError(410, "link_unavailable", "链接已失效", {});
    const { fetchMails } = scripted([page([1], 1), gone]);
    const store = new PickupMailStore(fetchMails, DELAYS, INTERVAL_SEC);
    store.start();
    await flush();
    await vi.advanceTimersByTimeAsync(INTERVAL_SEC * 1000);
    expect(store.getSnapshot().stopped).toBe("gone");
    expect(store.getSnapshot().items.map((m) => m.id)).toEqual([1]);

    const lost = scripted([page([1], 1), new PickupError(401, "link_start_required", "请先开始取码", {})]);
    const second = new PickupMailStore(lost.fetchMails, DELAYS, INTERVAL_SEC);
    second.start();
    await flush();
    await vi.advanceTimersByTimeAsync(INTERVAL_SEC * 1000);
    expect(second.getSnapshot().stopped).toBe("needs_start");
  });

  it("其他错误：保留已显示的内容并暴露错误，下个周期自动重试", async () => {
    const { fetchMails } = scripted([page([1], 1), new Error("boom"), page([2], 2)]);
    const store = new PickupMailStore(fetchMails, DELAYS, INTERVAL_SEC);
    store.start();
    await flush();
    await vi.advanceTimersByTimeAsync(INTERVAL_SEC * 1000);
    expect(String(store.getSnapshot().error)).toContain("boom");
    expect(store.getSnapshot().items.map((m) => m.id)).toEqual([1]);
    await vi.advanceTimersByTimeAsync(INTERVAL_SEC * 1000);
    expect(store.getSnapshot().error).toBeNull();
    expect(store.getSnapshot().items.map((m) => m.id)).toEqual([2, 1]);
    store.dispose();
  });
});

describe("mergeMails", () => {
  it("按时间倒序；已显示的不会被同一封的“未显示”版本盖回去", () => {
    const shown = mail(1, { subject: "码" });
    const merged = mergeMails([shown], [{ id: 1, received_at: shown.received_at, locked: true }, mail(2)]);
    expect(merged.map((m) => m.id)).toEqual([2, 1]);
    expect(merged[1]?.locked).toBeUndefined();
    expect(merged[1]?.subject).toBe("码");
  });
});
