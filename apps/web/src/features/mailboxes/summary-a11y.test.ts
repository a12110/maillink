import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellCss = readFileSync(new URL("../../styles/shell.css", import.meta.url), "utf8");

describe("页头摘要的分隔点", () => {
  it("伪元素的替代文本为空，读屏器读不到「·」（按钮名称只有「启用 4」）", () => {
    const rule = shellCss.split("\n").find((line) => line.includes(".summary > * + *::before"));
    expect(rule).toContain('content: "·" / ""');
  });
});
