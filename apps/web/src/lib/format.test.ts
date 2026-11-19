import { describe, expect, it } from "vitest";
import { describeUserAgent, displayNameOf, formatDateTime, initialOf } from "./format";

describe("formatDateTime", () => {
  it("今年内省略年份，跨年带年份", () => {
    const sec = new Date(2026, 10, 20, 14, 5).getTime() / 1000;
    expect(formatDateTime(sec, new Date(2026, 11, 1))).toBe("11-20 14:05");
    expect(formatDateTime(sec, new Date(2027, 0, 5))).toBe("2026-11-20 14:05");
  });
  it("null 显示 —", () => {
    expect(formatDateTime(null)).toBe("—");
  });
});

describe("describeUserAgent", () => {
  it("识别常见浏览器与系统", () => {
    const chromeMac =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    const edgeWin =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
    const safariIos =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
    expect(describeUserAgent(chromeMac)).toBe("Chrome · macOS");
    expect(describeUserAgent(edgeWin)).toBe("Edge · Windows");
    expect(describeUserAgent(safariIos)).toBe("Safari · iOS");
  });
  it("认不出的原样返回，缺失时写未知设备", () => {
    expect(describeUserAgent("curl/8.4.0")).toBe("curl/8.4.0");
    expect(describeUserAgent(null)).toBe("未知设备");
  });
});

describe("名称", () => {
  it("显示名优先，空白显示名回落到用户名", () => {
    expect(displayNameOf({ username: "alice", display_name: "爱丽丝" })).toBe("爱丽丝");
    expect(displayNameOf({ username: "alice", display_name: "  " })).toBe("alice");
    expect(displayNameOf({ username: "alice", display_name: null })).toBe("alice");
  });
  it("首字母头像", () => {
    expect(initialOf("alice")).toBe("A");
    expect(initialOf("爱丽丝")).toBe("爱");
  });
});
