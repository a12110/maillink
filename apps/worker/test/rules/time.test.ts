import type { TimeConfig } from "@maillink/shared";
import { describe, expect, it } from "vitest";
import { limitToNewest } from "../../src/rules/limit";
import { computeTimeLowerBound, type TimeAnchors } from "../../src/rules/time";
import { NOW } from "./helpers";

// 时间下界（02 §3.1）与 max_mails。

const MIN = 60;
const CREATED = NOW - 86_400;
const FIRST = NOW - 3_600;
const RESET = NOW - 1_800;

const anchors = (overrides: Partial<TimeAnchors> = {}): TimeAnchors => ({
  created_at: CREATED,
  first_access_at: null,
  anchor_reset_at: null,
  ...overrides,
});

describe("computeTimeLowerBound", () => {
  it.each<[string, TimeConfig, Partial<TimeAnchors>, number | null]>([
    ["无任何来源 → 没有下界", { since: { type: "none" } }, {}, null],
    ["只有滚动窗口", { window_minutes: 10, since: { type: "none" } }, {}, NOW - 10 * MIN],
    ["创建时间", { since: { type: "subject_created" } }, {}, CREATED],
    ["创建时间 − lookback", { since: { type: "subject_created", lookback_minutes: 5 } }, {}, CREATED - 5 * MIN],
    ["首次访问", { since: { type: "first_access" } }, { first_access_at: FIRST }, FIRST],
    ["首次访问 − lookback（买家先点发送再开链接）", { since: { type: "first_access", lookback_minutes: 5 } }, { first_access_at: FIRST }, FIRST - 5 * MIN],
    ["首次访问前没有锚点：当前时间 − lookback", { since: { type: "first_access", lookback_minutes: 5 } }, {}, NOW - 5 * MIN],
    ["首次访问前、无 lookback：只看现在之后", { since: { type: "first_access" } }, {}, NOW],
    ["固定时间", { since: { type: "fixed", at: NOW - 999 } }, {}, NOW - 999],
    ["固定时间忽略 lookback", { since: { type: "fixed", at: NOW - 999, lookback_minutes: 5 } }, {}, NOW - 999],
    ["窗口与创建时间取较晚（窗口更晚）", { window_minutes: 10, since: { type: "subject_created" } }, {}, NOW - 10 * MIN],
    ["窗口与首次访问取较晚（首次访问更晚）", { window_minutes: 120, since: { type: "first_access" } }, { first_access_at: FIRST }, FIRST],
    ["模板 A：15 分钟窗口 + 首次访问 − 5 分钟", { window_minutes: 15, since: { type: "first_access", lookback_minutes: 5 } }, { first_access_at: NOW - 60 }, NOW - 6 * MIN],
    ["重置锚点晚于创建时间：取重置时间", { since: { type: "subject_created", lookback_minutes: 1 } }, { anchor_reset_at: RESET }, RESET - MIN],
    ["重置锚点早于首次访问：取首次访问", { since: { type: "first_access" } }, { first_access_at: FIRST, anchor_reset_at: FIRST - 100 }, FIRST],
    ["重置锚点晚于首次访问：取重置时间（售后换号）", { since: { type: "first_access" } }, { first_access_at: FIRST, anchor_reset_at: RESET }, RESET],
    ["重置锚点 + 首次访问前（now 更晚）", { since: { type: "first_access" } }, { anchor_reset_at: RESET }, NOW],
    ["（补充）fixed 也服从重置锚点", { since: { type: "fixed", at: NOW - 99_999 } }, { anchor_reset_at: RESET }, RESET],
    ["（补充）none 也服从重置锚点", { since: { type: "none" } }, { anchor_reset_at: RESET }, RESET],
    ["（补充）none + 重置 + 窗口取较晚", { window_minutes: 10, since: { type: "none" } }, { anchor_reset_at: RESET }, NOW - 10 * MIN],
  ])("%s", (_name, time, overrides, expected) => {
    expect(computeTimeLowerBound(time, anchors(overrides), NOW)).toBe(expected);
  });

  it.each([Number.NaN, 1.5, Number.POSITIVE_INFINITY])("非整数秒直接抛错：now=%s", (now) => {
    expect(() => computeTimeLowerBound({ since: { type: "none" } }, anchors(), now)).toThrow(RangeError);
  });

  it("锚点不是整数秒（例如误传毫秒以外的小数）时抛错", () => {
    expect(() => computeTimeLowerBound({ since: { type: "first_access" } }, anchors({ first_access_at: 1.5 }), NOW)).toThrow(RangeError);
  });

  it("fixed 缺 at（绕过了校验）时抛错而不是放开", () => {
    expect(() => computeTimeLowerBound({ since: { type: "fixed" } }, anchors(), NOW)).toThrow();
  });
});

describe("limitToNewest（max_mails）", () => {
  const items = [
    { mail_id: 1, received_at: 100 },
    { mail_id: 5, received_at: 300 },
    { mail_id: 3, received_at: 200 },
    { mail_id: 4, received_at: 300 },
    { mail_id: 2, received_at: 150 },
  ];

  it.each<[number | undefined, number[]]>([
    [undefined, [5, 4, 3, 2, 1]],
    [3, [5, 4, 3]],
    [1, [5]],
    [10, [5, 4, 3, 2, 1]],
  ])("max_mails=%s → %j（按时间降序、同秒按 id 降序）", (max, ids) => {
    expect(limitToNewest(items, max).map((m) => m.mail_id)).toEqual(ids);
  });

  it("不修改入参", () => {
    const copy = items.map((m) => ({ ...m }));
    limitToNewest(items, 2);
    expect(items).toEqual(copy);
  });

  it.each([0, -1, 1.5])("非法 max_mails=%s 抛错", (max) => {
    expect(() => limitToNewest(items, max)).toThrow(RangeError);
  });
});
