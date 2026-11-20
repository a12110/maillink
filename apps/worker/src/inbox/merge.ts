import type { PresentedMail, VisibleMailListResponse } from "@maillink/shared";

// "全部"邮件：把多个作用域各自取到的一页合并成一页。纯函数，不碰数据库。
//
// 每个作用域的一页都带"覆盖范围"：
//   - 翻页（id 倒序）：作用域已把 id ≥ floor 的邮件全部判定过（floor = 它的 next_cursor；null = 已扫完，floor 为 0）；
//     它的下一页从 id < floor 开始。pending 时 next_cursor = pending.id + 1，同样满足这个约定。
//   - 增量轮询（id 正序）：作用域已覆盖 (after_id, next_after_id]。
// 合并只能交付"所有作用域都已覆盖"的区间，游标 / after_id 停在这个区间的边界上，所以不漏、不重。

export type ScopePage = VisibleMailListResponse;

/** 作用域一页的 floor；设了 max_mails 的作用域整组一次给齐（next_cursor 为 null），但 partial 时不知道已确定到哪里 */
function floorOf(page: ScopePage): number {
  if (page.next_cursor !== null) return Number(page.next_cursor);
  return page.partial ? Number.POSITIVE_INFINITY : 0;
}

export type DescendingMerge = { items: PresentedMail[]; next_cursor: string | null; partial: boolean };

export type DescendingOptions = {
  pageSize: number;
  /** 首页的快照上界：id 大于它的邮件留给之后的增量轮询 */
  maxId?: number;
  /** 请求里的 cursor；有作用域 partial 且无从确定边界时原样返回，调用方本来就要用同样的参数重取 */
  requestCursor: string | null;
};

/**
 * 翻页合并（含首页）。
 * 只交付 id ≥ F 的邮件，F = 各作用域 floor 的最大值：低于 F 的区间里，floor 最高的那个作用域还没扫到，
 * 它在那里的邮件会比我们交付的更新，一旦交付了更旧的邮件并把游标放到它们下面，就永远漏掉。
 * 候选超过一页时取 id 最大的 pageSize 封，游标 = 其中最小的 id（被截掉的都比它小，下一页重新取到）；
 * 否则候选全部交付，游标 = F（F 为 0 即全部扫完，游标 null）。
 */
export function mergeDescending(pages: readonly ScopePage[], options: DescendingOptions): DescendingMerge {
  const partial = pages.some((page) => page.partial);
  const floor = Math.max(0, ...pages.map(floorOf));
  if (floor === Number.POSITIVE_INFINITY) return { items: [], next_cursor: options.requestCursor, partial };
  const candidates = pages
    .flatMap((page) => page.items)
    .filter((mail) => mail.id >= floor && (options.maxId === undefined || mail.id <= options.maxId))
    .toSorted((a, b) => b.id - a.id);
  const kept = candidates.slice(0, options.pageSize);
  const last = kept.at(-1);
  if (candidates.length > options.pageSize && last) return { items: kept, next_cursor: String(last.id), partial };
  return { items: kept, next_cursor: floor > 0 ? String(floor) : null, partial };
}

export type AscendingMerge = { items: PresentedMail[]; next_after_id: number; partial: boolean };

export type AscendingOptions = {
  afterId: number;
  pageSize: number;
  /** 开始查询之前读到的最大邮件 id：之后才入库的邮件可能没被先查的作用域看到，不能越过它 */
  snapshot: number;
};

/**
 * 增量轮询合并。有作用域 partial 时不给结果也不推进 after_id（客户端用同样的参数重取，
 * 等 pending 的邮件解析完）。否则边界 = min(snapshot, 各"有进展"作用域的 next_after_id)：
 * 没有进展的作用域在 after_id 之后没有候选，不限制边界；有进展的作用域只保证覆盖到它自己扫到的最后一封
 * （我们不知道它是否已扫完），所以边界不能超过它。交付 (after_id, 边界] 内最旧的 pageSize 封，
 * 超出一页时边界收到最后一封的 id。
 */
export function mergeAscending(pages: readonly ScopePage[], options: AscendingOptions): AscendingMerge {
  const { afterId, pageSize, snapshot } = options;
  if (pages.some((page) => page.partial)) return { items: [], next_after_id: afterId, partial: true };
  const progressed = pages.flatMap((page) => (page.next_after_id !== null && page.next_after_id > afterId ? [page.next_after_id] : []));
  const bound = Math.min(snapshot, ...progressed);
  if (bound <= afterId) return { items: [], next_after_id: afterId, partial: false };
  const candidates = pages
    .flatMap((page) => page.items)
    .filter((mail) => mail.id > afterId && mail.id <= bound)
    .toSorted((a, b) => a.id - b.id);
  const kept = candidates.slice(0, pageSize);
  const last = kept.at(-1);
  const nextAfterId = candidates.length > pageSize && last ? last.id : bound;
  return { items: kept.toReversed(), next_after_id: nextAfterId, partial: false };
}
