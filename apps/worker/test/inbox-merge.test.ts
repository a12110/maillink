import { describe, expect, it } from "vitest";
import type { VisibleMailListResponse } from "@maillink/shared";
import { mergeAscending, mergeDescending } from "../src/inbox/merge";

// "全部"归并的纯函数：合成各作用域的一页，检查交付区间与游标。

const mail = (id: number) => ({ id, received_at: id });
const page = (ids: number[], extra: Partial<VisibleMailListResponse> = {}): VisibleMailListResponse => ({
  items: ids.map(mail),
  next_cursor: null,
  partial: false,
  next_after_id: null,
  ...extra,
});
const idsOf = (result: { items: Array<{ id: number }> }) => result.items.map((item) => item.id);

describe("mergeDescending（翻页与首页）", () => {
  const options = { pageSize: 20, requestCursor: null };

  it("全部作用域都扫完：按 id 降序交付全部，游标 null", () => {
    const merged = mergeDescending([page([90, 70]), page([100, 80])], options);
    expect(idsOf(merged)).toEqual([100, 90, 80, 70]);
    expect(merged).toMatchObject({ next_cursor: null, partial: false });
  });

  it("有作用域没扫完：只交付 id ≥ F（各作用域 floor 的最大值），游标 = F，更旧的留给下一页", () => {
    // 作用域 1 扫到了 80（下一页从 id < 80 开始）；作用域 2 已扫完，但它的 70、60 比 80 旧：
    // 作用域 1 在 (70, 80) 之间可能还有没扫到的邮件，现在交付 70 会让游标越过它们
    const merged = mergeDescending([page([100, 90, 80], { next_cursor: "80" }), page([95, 70, 60])], options);
    expect(idsOf(merged)).toEqual([100, 95, 90, 80]);
    expect(merged.next_cursor).toBe("80");
  });

  it("候选超过一页：取最大的 pageSize 封，游标 = 其中最小的 id", () => {
    const merged = mergeDescending([page([100, 90, 80], { next_cursor: "80" }), page([95, 85, 82])], { ...options, pageSize: 4 });
    expect(idsOf(merged)).toEqual([100, 95, 90, 85]);
    expect(merged.next_cursor).toBe("85");
  });

  it("没有任何候选但有作用域未扫完：游标推进到 floor（不原地打转）", () => {
    const merged = mergeDescending([page([], { next_cursor: "50" }), page([])], options);
    expect(merged).toMatchObject({ items: [], next_cursor: "50" });
  });

  it("partial：任一作用域 partial 则整体 partial；pending 的 next_cursor = pending.id + 1 同样作为 floor", () => {
    const merged = mergeDescending([page([100, 90], { next_cursor: "86", partial: true }), page([95, 80])], options);
    expect(merged.partial).toBe(true);
    expect(idsOf(merged)).toEqual([100, 95, 90]);
    expect(merged.next_cursor).toBe("86");
  });

  it("max_mails 作用域 partial（next_cursor 为 null、边界未知）：不交付任何邮件，原样返回请求游标", () => {
    const merged = mergeDescending([page([100], { partial: true }), page([95])], { ...options, requestCursor: "200" });
    expect(merged).toEqual({ items: [], next_cursor: "200", partial: true });
  });

  it("maxId：首页快照之后入库的邮件不交付（留给增量轮询）", () => {
    const merged = mergeDescending([page([120, 100]), page([110, 90])], { ...options, maxId: 105 });
    expect(idsOf(merged)).toEqual([100, 90]);
  });

  it("逐页走完：不漏不重", () => {
    const all = [[100, 97, 94, 91, 88, 85], [99, 96, 93, 90, 87, 84], [98, 95, 92, 89, 86, 83]];
    // 模拟每个作用域按自己的页大小（4）取一页：id < cursor，扫到哪里 next_cursor 就是哪里
    const scopePage = (all_: number[], cursor: number) => {
      const rest = all_.filter((id) => id < cursor);
      const taken = rest.slice(0, 4);
      const more = rest.length > taken.length;
      return page(taken, { next_cursor: more ? String(taken.at(-1)) : null });
    };
    const seen: number[] = [];
    let cursor = Number.MAX_SAFE_INTEGER;
    for (let round = 0; round < 20; round += 1) {
      const merged = mergeDescending(all.map((ids) => scopePage(ids, cursor)), { pageSize: 5, requestCursor: null });
      seen.push(...idsOf(merged));
      if (merged.next_cursor === null) break;
      expect(Number(merged.next_cursor)).toBeLessThan(cursor);
      cursor = Number(merged.next_cursor);
    }
    expect(seen).toEqual(all.flat().toSorted((a, b) => b - a));
  });
});

describe("mergeAscending（增量轮询）", () => {
  const options = { afterId: 100, pageSize: 20, snapshot: 130 };

  it("边界取各有进展作用域 next_after_id 的最小值：超出边界的邮件留到下一轮", () => {
    const merged = mergeAscending(
      [page([105], { next_after_id: 105 }), page([110, 120], { next_after_id: 120 })],
      options,
    );
    expect(idsOf(merged)).toEqual([105]);
    expect(merged.next_after_id).toBe(105);
  });

  it("没有进展的作用域不限制边界；全都没进展时推进到快照", () => {
    expect(mergeAscending([page([110], { next_after_id: 110 }), page([], { next_after_id: 100 })], options)).toMatchObject({
      items: [mail(110)],
      next_after_id: 110,
    });
    expect(mergeAscending([page([], { next_after_id: 100 }), page([], { next_after_id: 100 })], options)).toEqual({
      items: [],
      next_after_id: 130,
      partial: false,
    });
  });

  it("边界不超过快照：快照之后入库的邮件不交付", () => {
    const merged = mergeAscending([page([110, 140], { next_after_id: 140 })], options);
    expect(idsOf(merged)).toEqual([110]);
    expect(merged.next_after_id).toBe(130);
  });

  it("partial：不给结果、不推进 after_id", () => {
    const merged = mergeAscending([page([110], { next_after_id: 110 }), page([], { next_after_id: 100, partial: true })], options);
    expect(merged).toEqual({ items: [], next_after_id: 100, partial: true });
  });

  it("超出一页：交付最旧的 pageSize 封，after_id 收到最后一封", () => {
    const merged = mergeAscending([page([101, 103, 105], { next_after_id: 105 }), page([102, 104], { next_after_id: 104 })], {
      ...options,
      pageSize: 3,
    });
    expect(idsOf(merged)).toEqual([103, 102, 101]);
    expect(merged.next_after_id).toBe(103);
  });
});
