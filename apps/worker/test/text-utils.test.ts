import { describe, expect, it } from "vitest";
import { toWellFormedString, truncateChars } from "../src/text-utils";

describe("text-utils", () => {
  it("truncateChars 按码点截断，不切开 emoji", () => {
    expect(truncateChars("a😀b😀c", 3)).toBe("a😀b");
    expect(truncateChars("😀😀😀", 2)).toBe("😀😀");
    expect(truncateChars("short", 10)).toBe("short");
  });

  it("toWellFormedString：孤立代理项换成 U+FFFD，合法的 emoji 不动", () => {
    expect(toWellFormedString("a\uD83D")).toBe("a\uFFFD");
    expect(toWellFormedString("\uDE00b")).toBe("\uFFFDb");
    expect(toWellFormedString("a😀b")).toBe("a😀b");
    expect(() => encodeURIComponent(toWellFormedString("x\uD83D"))).not.toThrow();
  });
});
