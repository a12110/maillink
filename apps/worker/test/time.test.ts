import { describe, expect, it } from "vitest";
import { formatD1Utc, parseD1Utc } from "../src/mail-source/time";

describe("formatD1Utc", () => {
  it("格式化为 UTC 文本 YYYY-MM-DD HH:MM:SS", () => {
    expect(formatD1Utc(Date.UTC(2026, 10, 20, 8, 5, 9))).toBe("2026-11-20 08:05:09");
  });

  it("Unix 纪元", () => {
    expect(formatD1Utc(0)).toBe("1970-01-01 00:00:00");
  });

  it("毫秒向下取整到秒，不进位", () => {
    expect(formatD1Utc(Date.UTC(2026, 0, 1, 0, 0, 0, 999))).toBe("2026-01-01 00:00:00");
  });

  it("早于 1970 的时间", () => {
    expect(formatD1Utc(Date.UTC(1969, 11, 31, 23, 59, 59))).toBe("1969-12-31 23:59:59");
  });

  it("年末最后一秒与闰日", () => {
    expect(formatD1Utc(Date.UTC(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31 23:59:59");
    expect(formatD1Utc(Date.UTC(2028, 1, 29, 12, 0, 0))).toBe("2028-02-29 12:00:00");
  });

  it("非有限数与超出范围时抛 RangeError，不返回垃圾文本", () => {
    expect(() => formatD1Utc(Number.NaN)).toThrow(RangeError);
    expect(() => formatD1Utc(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => formatD1Utc(253_402_300_800_000)).toThrow(RangeError);
  });
});

describe("parseD1Utc", () => {
  it("解析为 UTC 毫秒", () => {
    expect(parseD1Utc("2026-11-20 08:05:09")).toBe(Date.UTC(2026, 10, 20, 8, 5, 9));
    expect(parseD1Utc("1970-01-01 00:00:00")).toBe(0);
  });

  it("接受闰日，拒绝非闰年的 2 月 29 日", () => {
    expect(parseD1Utc("2028-02-29 00:00:00")).toBe(Date.UTC(2028, 1, 29));
    expect(() => parseD1Utc("2026-02-29 00:00:00")).toThrow(RangeError);
  });

  it.each([
    ["空串", ""],
    ["ISO 的 T 分隔", "2026-11-20T08:05:09"],
    ["带 Z", "2026-11-20 08:05:09Z"],
    ["带毫秒", "2026-11-20 08:05:09.123"],
    ["缺秒", "2026-11-20 08:05"],
    ["首尾空白", " 2026-11-20 08:05:09"],
    ["13 月", "2026-13-01 00:00:00"],
    ["0 日", "2026-11-00 00:00:00"],
    ["25 时", "2026-11-20 25:00:00"],
    ["60 分", "2026-11-20 08:60:00"],
    ["2 月 30 日", "2026-02-30 00:00:00"],
  ])("拒绝非法输入：%s", (_name, text) => {
    expect(() => parseD1Utc(text)).toThrow(RangeError);
  });

  it("与 formatD1Utc 往返一致", () => {
    const samples = [
      "1970-01-01 00:00:00",
      "1999-12-31 23:59:59",
      "2026-11-20 08:05:09",
      "2028-02-29 12:34:56",
      "9999-12-31 23:59:59",
    ];
    for (const text of samples) {
      expect(formatD1Utc(parseD1Utc(text))).toBe(text);
    }
    const ms = Date.UTC(2026, 5, 15, 12, 30, 45);
    expect(parseD1Utc(formatD1Utc(ms))).toBe(ms);
  });

  it("文本的字典序与时间序一致（SQL 里按文本比较的前提）", () => {
    const earlier = formatD1Utc(Date.UTC(2026, 10, 20, 8, 0, 0));
    const later = formatD1Utc(Date.UTC(2026, 10, 20, 8, 0, 1));
    expect(earlier < later).toBe(true);
  });
});
