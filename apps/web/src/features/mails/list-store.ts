import type { AdminMailListItem, AdminMailListResponse } from "@maillink/shared";

// “全部邮件”列表的游标分页与 partial 重取。独立于 React，便于用假时钟测试；
// 约定（见 packages/shared/src/mails.ts）：响应 partial=true 时本页有邮件还没解析完，
// 调用方稍后重取【同一个请求】，期间不推进游标（不翻到下一页），直到 partial 为 false。

export type MailPage = {
  cursor: string | undefined;
  items: readonly AdminMailListItem[];
  nextCursor: string | null;
};

export type PartialProgress = {
  /** 正在等待 / 进行的重取序号（从 1 开始） */
  attempt: number;
  /** 重取次数用完，最后一页仍不完整 */
  exhausted: boolean;
};

export type MailListState = {
  pages: readonly MailPage[];
  busy: "first" | "more" | "refetch" | null;
  /** 最近一次请求失败的原因；已显示的内容保留 */
  error: unknown;
  hasError: boolean;
  /** 最后一页仍有 pending 邮件时的重取进度；null = 最后一页完整 */
  partial: PartialProgress | null;
};

export type FetchMailPage = (cursor: string | undefined) => Promise<AdminMailListResponse>;

type Mode = "first" | "more" | "refetch";
type Operation = { cursor: string | undefined; mode: Mode };

const IDLE: MailListState = { pages: [], busy: null, error: null, hasError: false, partial: null };

export function listItems(state: MailListState): AdminMailListItem[] {
  return state.pages.flatMap((page) => page.items);
}

/** 能不能“加载更多”：最后一页完整、还有下一页、没有请求在途 */
export function nextCursorOf(state: MailListState): string | null {
  if (state.busy !== null || state.partial !== null || state.hasError) return null;
  return state.pages.at(-1)?.nextCursor ?? null;
}

export class MailListStore {
  private state: MailListState = IDLE;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private retriesDone = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastOperation: Operation = { cursor: undefined, mode: "first" };

  constructor(
    private readonly fetchPage: FetchMailPage,
    private readonly delaysMs: readonly number[],
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MailListState => this.state;

  /** 换筛选或刷新：丢掉旧结果与在途请求，从第一页开始 */
  start(): void {
    this.cancel();
    this.retriesDone = 0;
    this.set(IDLE);
    this.run({ cursor: undefined, mode: "first" });
  }

  /** 刷新：保留旧列表（不闪成骨架），只重新请求第一页；成功后整体替换 */
  refresh(): void {
    this.cancel();
    this.retriesDone = 0;
    this.set({ ...this.state, partial: null });
    this.run({ cursor: undefined, mode: "first" });
  }

  loadMore(): void {
    const cursor = nextCursorOf(this.state);
    if (cursor !== null) this.run({ cursor, mode: "more" });
  }

  /** 失败或重取用尽后的手动重试：重新请求出问题的那一页，重取计数清零 */
  retry(): void {
    if (this.state.busy !== null) return;
    this.cancel();
    this.retriesDone = 0;
    this.set({ ...this.state, hasError: false, error: null, partial: null });
    this.run(this.lastOperation);
  }

  dispose(): void {
    this.cancel();
  }

  private cancel(): void {
    this.generation += 1;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private set(next: MailListState): void {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  private run(operation: Operation): void {
    this.lastOperation = operation;
    const generation = this.generation;
    this.set({ ...this.state, busy: operation.mode, hasError: false, error: null });
    this.fetchPage(operation.cursor).then(
      (response) => {
        if (generation === this.generation) this.accept(operation, response);
      },
      (error: unknown) => {
        if (generation === this.generation) this.set({ ...this.state, busy: null, error, hasError: true });
      },
    );
  }

  private accept(operation: Operation, response: AdminMailListResponse): void {
    const page: MailPage = { cursor: operation.cursor, items: response.items, nextCursor: response.next_cursor };
    const kept = operation.mode === "first" ? [] : operation.mode === "refetch" ? this.state.pages.slice(0, -1) : this.state.pages;
    const pages = [...kept, page];
    if (!response.partial) {
      this.retriesDone = 0;
      this.set({ pages, busy: null, error: null, hasError: false, partial: null });
      return;
    }
    const delay = this.delaysMs[this.retriesDone];
    if (delay === undefined) {
      this.set({ pages, busy: null, error: null, hasError: false, partial: { attempt: this.retriesDone, exhausted: true } });
      return;
    }
    this.retriesDone += 1;
    this.set({ pages, busy: null, error: null, hasError: false, partial: { attempt: this.retriesDone, exhausted: false } });
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation === this.generation) this.run({ cursor: operation.cursor, mode: "refetch" });
    }, delay);
  }
}
