// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_DEBOUNCE_MS } from "../../constants";
import { mount, typeInto } from "../../test/render";
import type { Mounted } from "../../test/render";
import { MailFilterBar } from "./MailFilterBar";
import type { MailFilters } from "./search";

let mounted: Mounted | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

function input(label: string): HTMLInputElement {
  const found = Array.from(mounted?.container.querySelectorAll("label") ?? []).find((l) => l.textContent === label);
  const target = found?.htmlFor ? document.getElementById(found.htmlFor) : null;
  if (!(target instanceof HTMLInputElement)) throw new Error(`找不到输入框：${label}`);
  return target;
}

function bar(filters: MailFilters, onChange: (next: MailFilters) => void) {
  return createElement(MailFilterBar, { filters, onChange });
}

describe("MailFilterBar：URL ↔ 筛选输入框", () => {
  it("URL 里的筛选条件显示在输入框里（从“该地址的邮件”跳转过来）", async () => {
    mounted = await mount(bar({ to_address: "alias@icloud.com", scope: "unknown", since: 1_700_000_000 }, vi.fn()));
    expect(input("收件地址").value).toBe("alias@icloud.com");
    expect(input("开始时间").value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const select = mounted.container.querySelector("select");
    expect(select?.value).toBe("unknown");
  });

  it("输入停顿后才写入 URL（防抖），写入的是规范化后的条件", async () => {
    const onChange = vi.fn();
    mounted = await mount(bar({ scope: "imported" }, onChange));
    await typeInto(input("收件地址"), "  a@b.c ");
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ to_address: "a@b.c", scope: "imported" });
  });

  it("按 Enter 立即写入", async () => {
    const onChange = vi.fn();
    mounted = await mount(bar({}, onChange));
    const field = input("信封发件人");
    await typeInto(field, "noreply@x.com");
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({ source: "noreply@x.com" });
  });

  it("URL 因后退等原因变化：输入框跟着更新", async () => {
    mounted = await mount(bar({ to_address: "old@x.com" }, vi.fn()));
    await mounted.render(bar({ to_address: "new@x.com", address: "env@x.com" }, vi.fn()));
    expect(input("收件地址").value).toBe("new@x.com");
    expect(input("信封地址").value).toBe("env@x.com");
    await mounted.render(bar({}, vi.fn()));
    expect(input("收件地址").value).toBe("");
  });

  it("自己刚写入 URL 的那次变化不会把还在输入的字覆盖掉", async () => {
    const onChange = vi.fn();
    mounted = await mount(bar({}, onChange));
    await typeInto(input("收件地址"), "ab");
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    // 用户继续输入，此时 URL 才更新为 "ab"
    await typeInto(input("收件地址"), "abc");
    await mounted.render(bar({ to_address: "ab" }, onChange));
    expect(input("收件地址").value).toBe("abc");
  });

  it("开始时间晚于结束时间：不写入 URL，就地提示原因", async () => {
    const onChange = vi.fn();
    mounted = await mount(bar({}, onChange));
    await typeInto(input("开始时间"), "2026-11-21T00:00");
    expect(onChange).toHaveBeenCalledTimes(1);
    onChange.mockClear();
    await typeInto(input("结束时间"), "2026-11-20T00:00");
    expect(onChange).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toContain("开始时间不能晚于结束时间");
  });

  it("切换范围立即写入，并带上还没提交的文本草稿", async () => {
    const onChange = vi.fn();
    mounted = await mount(bar({}, onChange));
    await typeInto(input("收件地址"), "a@b.c");
    const select = mounted.container.querySelector("select");
    if (!select) throw new Error("没有范围下拉");
    await act(async () => {
      select.value = "unknown";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith({ to_address: "a@b.c", scope: "unknown" });
  });
});
