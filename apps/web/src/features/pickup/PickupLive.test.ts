// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PresentedMail, VisibleMailListResponse } from "@maillink/shared";
import { click } from "../../test/render";
import { buttonByText, fakeApi, installLifecycle, list, mail, nowSec, open, quota, settle, status, TOKEN } from "./pickup-test-kit";
import { PickupError } from "./pickup-api";
import type { PickupApi } from "./pickup-api";

installLifecycle();

describe("点击取码（reveal=click）", () => {
  it("locked 项显示有新邮件与剩余次数；点击 reveal 后显示验证码并更新剩余次数", async () => {
    const mails = vi.fn(async () => list([mail(5, 20, { locked: true })]));
    const reveal = vi.fn(async () => ({ mail: mail(5, 20, { code: "731205" }), counted: true, deliveries: quota({ total_used: 1, total_remaining: 1 }) }));
    const root = await open(fakeApi({ status: vi.fn(async () => status({ reveal: "click", deliveries: quota() })), mails, reveal }));
    expect(root.textContent).toContain("有 1 封新邮件");
    expect(root.textContent).toContain("总共还可取 2 次（共 2 次）");
    expect(root.textContent).not.toContain("731205");
    const button = buttonByText(root.querySelector(".pk-bar") as HTMLElement, "查看验证码");
    expect(button.textContent).toContain("（剩余 2 次）");
    await click(button);
    await settle();
    expect(reveal).toHaveBeenCalledWith(TOKEN, 5);
    expect(root.querySelector(".pk-code-card output")?.textContent).toBe("731205");
    expect(root.textContent).not.toContain("有 1 封新邮件");
  });

  it("总次数用尽：停止轮询并保留已显示的码", async () => {
    const mails = vi.fn(async () => list([mail(5, 20, { locked: true })]));
    const reveal = vi.fn(async () => ({ mail: mail(5, 20, { code: "731205" }), counted: true, deliveries: quota({ total_used: 2, total_remaining: 0 }) }));
    const root = await open(fakeApi({ status: vi.fn(async () => status({ reveal: "click", deliveries: quota({ total_used: 1, total_remaining: 1 }) })), mails, reveal }));
    await click(buttonByText(root, "查看验证码"));
    await settle();
    const callsAfterReveal = mails.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mails.mock.calls.length).toBe(callsAfterReveal);
    expect(root.querySelector(".pk-code-card output")?.textContent).toBe("731205");
    expect(root.textContent).toContain("取码次数已用完，已停止刷新");
  });

  const DAILY_RESET = () => nowSec() + 5 * 3600 + 40 * 60;
  const dailyDone = () => quota({ total_limit: null, total_remaining: null, daily_limit: 3, daily_used: 3, daily_remaining: 0, daily_resets_at: DAILY_RESET() });

  it("仅每日次数用尽：查看按钮禁用，说明约何时恢复且不是链接失效，不写“取码次数已用完”", async () => {
    const mails = vi.fn(async () => list([mail(5, 20, { locked: true })]));
    const root = await open(fakeApi({ status: vi.fn(async () => status({ reveal: "click", deliveries: dailyDone() })), mails }));
    expect(buttonByText(root, "查看验证码").disabled).toBe(true);
    expect(root.textContent).toContain("今天的次数用完了");
    expect(root.textContent).toContain("11-20 17:40");
    expect(root.textContent).toContain("这不是链接失效");
    expect(root.textContent).not.toContain("取码次数已用完");
    expect(root.textContent).not.toContain("已停止刷新");
  });

  it("取到当天最后一次后：保留刚取到的码、继续轮询，只提示每日恢复时间（不切到每日上限页）", async () => {
    const mails = vi.fn(async () => list([mail(5, 20, { locked: true })]));
    const reveal = vi.fn(async () => ({ mail: mail(5, 20, { code: "731205" }), counted: true, deliveries: dailyDone() }));
    const root = await open(fakeApi({ status: vi.fn(async () => status({ reveal: "click", deliveries: quota({ total_limit: null, total_remaining: null, daily_limit: 3, daily_used: 2, daily_remaining: 1 }) })), mails, reveal }));
    await click(buttonByText(root, "查看验证码"));
    await settle();
    expect(root.querySelector(".pk-code-card output")?.textContent).toBe("731205");
    expect(root.querySelector("h1")?.textContent).not.toBe("今天的取码次数用完了");
    expect(root.textContent).toContain("今天的次数用完了");
    expect(root.textContent).toContain("11-20 17:40");
    expect(root.textContent).toContain("这不是链接失效");
    expect(root.textContent).not.toContain("取码次数已用完");
    const calls = mails.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mails.mock.calls.length).toBeGreaterThan(calls);
  });

  it("reveal 返回每日上限（429）：重新取状态，切到每日上限页", async () => {
    const mails = vi.fn(async () => list([mail(5, 20, { locked: true })]));
    const reveal = vi.fn().mockRejectedValue(new PickupError(429, "link_daily_limit", "今日用完", { retry_after_at: nowSec() + 3600 }));
    const statusFn = vi.fn().mockResolvedValueOnce(status({ reveal: "click", deliveries: quota({ total_limit: null, total_remaining: null, daily_limit: 3, daily_used: 2, daily_remaining: 1 }) })).mockResolvedValue(status({ state: "daily_limit", retry_after_at: nowSec() + 3600, deliveries: quota({ daily_limit: 3 }) }));
    const root = await open(fakeApi({ status: statusFn, mails, reveal }));
    await click(buttonByText(root, "查看验证码"));
    await settle();
    expect(root.textContent).toContain("今天的取码次数用完了");
  });
});

describe("轮询暂停", () => {
  it("无操作一段时间后暂停，给“继续刷新”；点击后恢复", async () => {
    const api = fakeApi({ mails: vi.fn(async () => list([mail(1, 5, { code: "111222" })])) });
    const root = await open(api);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
    });
    expect(root.textContent).toContain("自动刷新已暂停");
    const calls = api.mails.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.mails.mock.calls.length).toBe(calls);
    await click(buttonByText(root.querySelector(".pk-bar") as HTMLElement, "继续刷新"));
    await settle();
    expect(api.mails.mock.calls.length).toBe(calls + 1);
    expect(root.textContent).not.toContain("自动刷新已暂停");
  });
});

describe("加载不全（partial）与新邮件提示", () => {
  const partial = (items: PresentedMail[]): VisibleMailListResponse => ({ items, next_cursor: null, partial: true, next_after_id: null });

  it("partial：静默补全（1s / 2s / 4s），保留已显示内容；3 次仍不全给出提示与重试，成功后消失", async () => {
    const one = mail(1, 30, { code: "111222" });
    const mails = vi.fn<PickupApi["mails"]>().mockResolvedValueOnce(partial([one])).mockResolvedValueOnce(partial([one])).mockResolvedValueOnce(partial([one])).mockResolvedValueOnce(partial([one])).mockResolvedValue(list([one]));
    const root = await open(fakeApi({ mails }));
    expect(root.textContent).toContain("正在补全邮件（第 1 次，共 3 次），不需要你操作");
    expect(root.querySelector(".pk-code-card output")?.textContent).toBe("111222");
    expect(root.querySelector('[role="alert"]')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(root.textContent).toContain("第 2 次");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(root.textContent).toContain("第 3 次");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("邮件没有加载完整（PARTIAL）");
    expect(root.querySelector(".pk-code-card output")?.textContent).toBe("111222");
    await click(buttonByText(root, "重试"));
    await settle();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.textContent).not.toContain("没有加载完整");
  });

  it("新邮件在后台到达：标题前缀、朗读、刚收到标签；回到前台恢复标题，标签 4 秒后消失", async () => {
    const first = list([mail(1, 30, { code: "111222" })]);
    const second: VisibleMailListResponse = { items: [mail(2, 1, { code: "556677" })], next_cursor: null, partial: false, next_after_id: 2 };
    const mails = vi.fn<PickupApi["mails"]>().mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValue(second);
    const root = await open(fakeApi({ mails }));
    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    setHidden(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mails).toHaveBeenCalledTimes(2);
    expect(document.title).toBe("(新) 验证码 · ChatGPT 共享号");
    expect(root.querySelector(".sr-only[role='status']")?.textContent).toBe("收到新验证码 5 5 6 6 7 7");
    expect(root.querySelector(".pk-code-card output")?.textContent).toBe("556677");
    expect(root.querySelector(".pk-code-card .tag")?.textContent).toBe("刚收到");
    expect(root.querySelector(".pk-code-card")?.getAttribute("data-fresh")).toBe("true");
    setHidden(false);
    await settle();
    expect(document.title).toBe("ChatGPT 共享号");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(root.querySelector(".pk-code-card .tag")).toBeNull();
    expect(root.querySelector(".pk-old .code")?.textContent).toBe("111222");
  });
});
