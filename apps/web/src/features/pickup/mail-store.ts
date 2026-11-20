import type { PresentedMail, VisibleMailListResponse } from "@maillink/shared";
import { MS_PER_SECOND } from "../../constants";
import { classifyPickupError } from "./failures";
import type { MailsQuery } from "./pickup-api";

// 取件页的邮件轮询与 partial 退避。独立于 React，便于用假时钟测试。
//
// 规则（PLAN M3b-2 / DESIGN「加载不全」）：
//  - 首次取第一页；之后用 after_id 增量轮询。after_id 一律取响应的 next_after_id：
//    partial=true 时它不会越过任何未就绪的邮件，所以【绝不用本批最大 id 推进】。
//  - 响应 partial=true：静默按 1s / 2s / 4s 重取同一请求（最多 3 次），期间保留已显示内容；
//    3 次仍不全：标记 exhausted，仍按正常间隔继续轮询，成功后清除，不吞错。
//  - 一段时间无操作（含页面一直在后台）后暂停，由用户点“继续刷新”恢复；
//    总次数用尽 / 链接失效 / 设备被清后停止，已显示的邮件保留。后台时照常轮询（新邮件才能在标题上提示）。

export type PartialProgress = { attempt: number; exhausted: boolean };
export type StopReason = "gone" | "quota" | "needs_start";
export type PauseReason = "idle";

export type MailStoreState = {
  items: readonly PresentedMail[];
  /** 更早一页的游标（列表视图“加载更早的邮件”） */
  nextCursor: string | null;
  afterId: number | null;
  loaded: boolean;
  busy: boolean;
  /** 最近一次请求失败的原因；已显示的内容保留，下个轮询周期会自动重试 */
  error: unknown;
  partial: PartialProgress | null;
  paused: PauseReason | null;
  stopped: StopReason | null;
  /** 下一次自动刷新的时间（ms 时间戳）；暂停 / 停止 / 请求中为 null */
  nextPollAt: number | null;
  /** 最近一次新邮件到达：seq 递增，UI 据此提示 */
  arrival: { seq: number; mails: readonly PresentedMail[] } | null;
};

export type FetchMails = (query: MailsQuery) => Promise<VisibleMailListResponse>;

type Mode = "first" | "poll" | "older";
type Operation = { query: MailsQuery; mode: Mode };

const INITIAL: MailStoreState = {
  items: [],
  nextCursor: null,
  afterId: null,
  loaded: false,
  busy: false,
  error: null,
  partial: null,
  paused: null,
  stopped: null,
  nextPollAt: null,
  arrival: null,
};

/** 新的在前；同一封邮件以后到的为准，但已显示的不会被"未显示"的版本盖回去（click 模式） */
export function mergeMails(current: readonly PresentedMail[], incoming: readonly PresentedMail[]): PresentedMail[] {
  const byId = new Map(current.map((mail) => [mail.id, mail]));
  for (const mail of incoming) {
    const existing = byId.get(mail.id);
    byId.set(mail.id, existing !== undefined && existing.locked !== true && mail.locked === true ? existing : mail);
  }
  return [...byId.values()].sort((a, b) => b.received_at - a.received_at || b.id - a.id);
}

export class PickupMailStore {
  private state: MailStoreState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private retriesDone = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastOperation: Operation = { query: {}, mode: "first" };
  private idle = false;
  private arrivalSeq = 0;

  constructor(
    private readonly fetchMails: FetchMails,
    private readonly delaysMs: readonly number[],
    private intervalSec: number,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MailStoreState => this.state;

  setIntervalSec(seconds: number): void {
    this.intervalSec = seconds;
  }

  start(): void {
    this.cancel();
    this.retriesDone = 0;
    this.set({ ...INITIAL, paused: this.pauseReason() });
    if (this.pauseReason() === null) this.run({ query: {}, mode: "first" });
  }

  /** 立即刷新 / 重试：丢掉等待中的定时器，马上按当前游标取一次。暂停或停止时不动 */
  refresh(): void {
    if (this.state.stopped !== null || this.state.busy || this.state.paused !== null) return;
    this.cancel();
    this.retriesDone = 0;
    this.runNext();
  }

  loadOlder(): void {
    const cursor = this.state.nextCursor;
    if (cursor === null || this.state.busy || this.state.stopped !== null) return;
    this.cancel();
    this.run({ query: { cursor }, mode: "older" });
  }

  /** 无操作暂停；false = 用户点了“继续刷新” */
  setIdle(idle: boolean): void {
    this.idle = idle;
    this.applyPause();
  }

  /** 链接失效 / 次数用尽 / 设备被清：停止轮询，已显示的邮件保留 */
  stop(reason: StopReason): void {
    this.cancel();
    this.set({ ...this.state, busy: false, stopped: reason, nextPollAt: null, partial: null });
  }

  /** 点击取码成功：用已显示的版本替换占位 */
  applyRevealed(mail: PresentedMail): void {
    this.set({ ...this.state, items: mergeMails(this.state.items.filter((item) => item.id !== mail.id), [mail]) });
  }

  dispose(): void {
    this.cancel();
  }

  private pauseReason(): PauseReason | null {
    return this.idle ? "idle" : null;
  }

  private applyPause(): void {
    const reason = this.pauseReason();
    if (reason === this.state.paused) return;
    if (reason !== null) {
      this.cancel();
      this.set({ ...this.state, paused: reason, busy: false, nextPollAt: null });
      return;
    }
    this.set({ ...this.state, paused: null });
    if (this.state.stopped === null) {
      this.retriesDone = 0;
      this.runNext();
    }
  }

  private runNext(): void {
    if (!this.state.loaded) this.run({ query: {}, mode: "first" });
    else this.run({ query: this.state.afterId === null ? {} : { after_id: this.state.afterId }, mode: "poll" });
  }

  private cancel(): void {
    this.generation += 1;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private set(next: MailStoreState): void {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  private run(operation: Operation): void {
    this.lastOperation = operation;
    const generation = this.generation;
    this.set({ ...this.state, busy: true, nextPollAt: null });
    this.fetchMails(operation.query).then(
      (response) => {
        if (generation === this.generation) this.accept(operation, response);
      },
      (error: unknown) => {
        if (generation === this.generation) this.fail(error);
      },
    );
  }

  private fail(error: unknown): void {
    const failure = classifyPickupError(error);
    if (failure.kind === "not_found" || failure.kind === "unavailable") return this.stop("gone");
    if (failure.kind === "start_required") return this.stop("needs_start");
    this.set({ ...this.state, busy: false, error });
    this.scheduleNormal();
  }

  private accept(operation: Operation, response: VisibleMailListResponse): void {
    const before = this.state;
    const known = new Set(before.items.map((mail) => mail.id));
    const items = mergeMails(before.items, response.items);
    // 只有增量轮询（含其 partial 重取）拿到的才算"新邮件到达"；首页与加载更早的不提示
    const fresh = operation.mode === "poll" ? response.items.filter((mail) => !known.has(mail.id)) : [];
    const next: MailStoreState = {
      ...before,
      items,
      loaded: true,
      busy: false,
      error: null,
      nextCursor: operation.mode === "poll" ? before.nextCursor : response.next_cursor,
      // 不用本批最大 id 推进：只信 next_after_id（partial 时它不越过未就绪的邮件）。older 页不动 after_id
      afterId: operation.mode === "older" || response.next_after_id === null ? before.afterId : response.next_after_id,
      arrival: fresh.length > 0 ? { seq: ++this.arrivalSeq, mails: fresh } : before.arrival,
    };
    if (!response.partial) {
      this.retriesDone = 0;
      this.set({ ...next, partial: null });
      this.scheduleNormal();
      return;
    }
    const delay = this.delaysMs[this.retriesDone];
    if (delay === undefined) {
      this.set({ ...next, partial: { attempt: this.retriesDone, exhausted: true } });
      this.scheduleNormal();
      return;
    }
    this.retriesDone += 1;
    this.set({ ...next, partial: { attempt: this.retriesDone, exhausted: false } });
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation === this.generation) this.run(this.lastOperation);
    }, delay);
  }

  private scheduleNormal(): void {
    if (this.state.stopped !== null || this.pauseReason() !== null) return;
    const delay = this.intervalSec * MS_PER_SECOND;
    this.set({ ...this.state, nextPollAt: Date.now() + delay });
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation === this.generation) this.runNext();
    }, delay);
  }
}
