// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { clearHandoff, resolveHandoff, saveHandoff } from "./create-handoff";

afterEach(() => sessionStorage.clear());

describe("收件地址页 → 创建对话框的地址交接", () => {
  it("按 URL 里的 id 顺序还原地址；交接里没有的 id 地址为 null（显示 #id，不编造）", () => {
    saveHandoff([{ id: 2, address: "b@x.com" }, { id: 1, address: "a@x.com" }]);
    expect(resolveHandoff([1, 2, 3])).toEqual([
      { id: 1, address: "a@x.com" },
      { id: 2, address: "b@x.com" },
      { id: 3, address: null },
    ]);
  });

  it("关闭后清掉；没有交接时全部为 null", () => {
    saveHandoff([{ id: 1, address: "a@x.com" }]);
    clearHandoff();
    expect(resolveHandoff([1])).toEqual([{ id: 1, address: null }]);
  });
});
