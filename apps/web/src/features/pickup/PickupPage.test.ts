// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkDeliveryQuota, LinkPublicStatus, PresentedMail, VisibleMailListResponse } from "@maillink/shared";
import { click, mount, typeInto } from "../../test/render";
import type { Mounted } from "../../test/render";
import { MAIL_FRAME_SANDBOX } from "../mail";
import { PickupPage } from "./PickupPage";
import { PickupError } from "./pickup-api";
import type { PickupApi } from "./pickup-api";

import type { TurnstileApi, TurnstileLoader, TurnstileRenderOptions } from "../turnstile/loader";

const loadTurnstile = vi.fn<TurnstileLoader>();

const TOKEN = "TOKEN_SECRET_VALUE_0123456789abcdefghijklmnopqrstuv";
const NOW = new Date(2026, 10, 20, 12, 0, 0);
const nowSec = () => Math.floor(NOW.getTime() / 1000);

let mounted: Mounted | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.clearAllMocks();
  document.title = "";
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
});

function status(overrides: Partial<LinkPublicStatus> = {}): LinkPublicStatus {
  return {
    state: "active",
    activated: true,
    visitor_registered: true,
    requires_password: false,
    requires_turnstile: false,
    turnstile: { required: false },
    site: { show_brand: false },
    view: "code_only",
    reveal: "auto",
    deliveries: null,
    poll_interval_sec: 10,
    mailboxes: ["sw***@icloud.com"],
    mailbox_count: 1,
    recipient_display: "masked",
    expires_at: nowSec() + 2 * 86_400,
    expire_after_first_access_sec: null,
    public_title: "ChatGPT 共享号",
    public_note: null,
    retry_after_at: null,
    ...overrides,
  };
}

function quota(overrides: Partial<LinkDeliveryQuota> = {}): LinkDeliveryQuota {
  return { total_limit: 2, total_used: 0, total_remaining: 2, daily_limit: null, daily_used: 0, daily_remaining: null, daily_resets_at: null, ...overrides };
}

function mail(id: number, ageSec: number, extra: Partial<PresentedMail> = {}): PresentedMail {
  return { id, received_at: nowSec() - ageSec, sender: { name: "OpenAI" }, ...extra };
}

function list(items: PresentedMail[]): VisibleMailListResponse {
  return { items, next_cursor: null, partial: false, next_after_id: items[0]?.id ?? null };
}

type MockedApi = { [K in keyof PickupApi]: ReturnType<typeof vi.fn<PickupApi[K]>> };

function fakeApi(over: Partial<PickupApi> = {}): MockedApi {
  const base: MockedApi = {
    status: vi.fn<PickupApi["status"]>(async () => status()),
    start: vi.fn<PickupApi["start"]>(async () => status()),
    mails: vi.fn<PickupApi["mails"]>(async () => list([])),
    reveal: vi.fn<PickupApi["reveal"]>(),
    detail: vi.fn<PickupApi["detail"]>(),
  };
  return Object.assign(base, over) as MockedApi;
}

async function open(api: PickupApi): Promise<HTMLElement> {
  mounted = await mount(createElement(PickupPage, { token: TOKEN, api, turnstileLoader: loadTurnstile }));
  await settle();
  return mounted.container;
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`找不到按钮：${text}\n${root.textContent}`);
  return found;
}

describe("取件页状态机：状态与错误码映射", () => {
  it("needs_start：标题、卖家说明、开始取码；文档标题不含 token", async () => {
    const root = await open(fakeApi({ status: vi.fn(async () => status({ state: "needs_start", visitor_registered: false, public_note: "登录时选邮箱验证码" })) }));
    expect(root.querySelector("h1")?.textContent).toBe("ChatGPT 共享号");
    expect(root.textContent).toContain("登录时选邮箱验证码");
    expect(buttonByText(root, "开始取码").disabled).toBe(false);
    expect(document.title).toBe("ChatGPT 共享号");
    expect(document.title).not.toContain(TOKEN);
    expect(document.documentElement.innerHTML).not.toContain(TOKEN);
  });

  it("device_limit：说明 + 卖家留言（纯文本）", async () => {
    const note = "换了手机请联系我\n微信 <b>x</b>";
    const root = await open(fakeApi({ status: vi.fn(async () => status({ state: "device_limit", visitor_registered: false, public_note: note })) }));
    expect(root.textContent).toContain("这个链接已在其他设备上使用");
    expect(root.querySelector(".pk-contact .note")?.textContent).toBe(note);
    expect(root.querySelector(".pk-contact b")).toBeNull();
    expect(root.querySelector("button")).toBeNull();
  });

  it("daily_limit：大约何时恢复，并说明不是链接失效", async () => {
    const retry = nowSec() + 5 * 3600 + 40 * 60;
    const root = await open(
      fakeApi({ status: vi.fn(async () => status({ state: "daily_limit", retry_after_at: retry, deliveries: quota({ daily_limit: 10, daily_remaining: 0, daily_resets_at: retry }), public_note: "找我加次数" })) }),
    );
    expect(root.textContent).toContain("今天的取码次数用完了");
    expect(root.textContent).toContain("每 24 小时最多取 10 次");
    expect(root.textContent).toContain("11-20 17:40");
    expect(root.textContent).toContain("5 小时 40 分钟");
    expect(root.textContent).toContain("不是链接失效");
    expect(root.textContent).toContain("找我加次数");
  });

  it("no_mailbox", async () => {
    const root = await open(fakeApi({ status: vi.fn(async () => status({ state: "no_mailbox" })) }));
    expect(root.textContent).toContain("暂时没有可用的收件地址");
  });

  it("404 → 链接不存在；410 → 链接已失效（不透露原因）；403 link_not_yet_valid → 生效时间", async () => {
    let root = await open(fakeApi({ status: vi.fn(async () => { throw new PickupError(404, "link_not_found", "链接不存在", {}); }) }));
    expect(root.querySelector("h1")?.textContent).toBe("链接不存在");
    await mounted?.unmount();

    root = await open(fakeApi({ status: vi.fn(async () => { throw new PickupError(410, "link_unavailable", "链接已失效", {}); }) }));
    expect(root.querySelector("h1")?.textContent).toBe("链接已失效");
    expect(root.textContent).not.toMatch(/撤销|暂停|过期|用尽|白名单/);
    await mounted?.unmount();

    root = await open(fakeApi({ status: vi.fn(async () => { throw new PickupError(403, "link_not_yet_valid", "尚未生效", { valid_from: nowSec() + 86_400 }); }) }));
    expect(root.querySelector("h1")?.textContent).toBe("还没到生效时间");
    expect(root.textContent).toContain("11-21 12:00");
  });

  it("其他错误：页面加载失败，带错误码与重试，不冒充已失效", async () => {
    const statusFn = vi.fn().mockRejectedValueOnce(new PickupError(503, "rate_limiter_not_configured", "限流未配置", {})).mockResolvedValue(status({ state: "no_mailbox" }));
    const root = await open(fakeApi({ status: statusFn }));
    expect(root.textContent).toContain("页面加载失败");
    expect(root.textContent).toContain("rate_limiter_not_configured");
    await click(buttonByText(root, "重试"));
    await settle();
    expect(root.textContent).toContain("暂时没有可用的收件地址");
  });

  it("品牌：show_brand 时显示名称与 data URI Logo（只用 img src）；https Logo 不渲染；公告纯文本", async () => {
    const data = "data:image/png;base64,AAAA";
    const brand = { show_brand: true, name: "我的小店", logo: data, notice: "公告 <script>x</script>" };
    let root = await open(fakeApi({ status: vi.fn(async () => status({ state: "needs_start", site: brand })) }));
    expect(root.querySelector(".pk-brand img")?.getAttribute("src")).toBe(data);
    expect(root.querySelector(".pk-brand")?.textContent).toContain("我的小店");
    expect(root.querySelector(".callout")?.textContent).toContain("公告 <script>x</script>");
    expect(root.querySelector("script")).toBeNull();
    expect(document.title).toBe("ChatGPT 共享号 · 我的小店");
    await mounted?.unmount();

    root = await open(fakeApi({ status: vi.fn(async () => status({ state: "needs_start", site: { show_brand: true, name: "店", logo: "https://evil.example/x.png" } })) }));
    expect(root.querySelector(".pk-brand img")).toBeNull();
    await mounted?.unmount();

    root = await open(fakeApi({ status: vi.fn(async () => status({ state: "needs_start", site: { show_brand: false } })) }));
    expect(root.querySelector(".pk-brand")).toBeNull();
  });
});

describe("开始取码：口令与人机验证", () => {
  const needsStart = (over: Partial<LinkPublicStatus> = {}) => status({ state: "needs_start", visitor_registered: false, ...over });

  it("需要口令：为空时禁用；提交带口令；成功后进入取码页并开始轮询", async () => {
    const api = fakeApi({ status: vi.fn(async () => needsStart({ requires_password: true, mailboxes: [] })), start: vi.fn(async () => status({ mailboxes: ["a***@icloud.com"] })) });
    const root = await open(api);
    expect(root.textContent).not.toContain("icloud.com");
    expect(buttonByText(root, "开始取码").disabled).toBe(true);
    await typeInto(root.querySelector('input[type="password"]') as HTMLInputElement, "hunter22");
    await click(buttonByText(root, "开始取码"));
    await settle();
    expect(api.start).toHaveBeenCalledWith(TOKEN, { password: "hunter22" });
    expect(api.mails).toHaveBeenCalledWith(TOKEN, {});
    expect(root.textContent).toContain("a***@icloud.com");
    expect(root.textContent).toContain("正在等待新邮件");
  });

  it("口令错误 / 锁定：就地提示，不离开本页；设备已满：切到设备已满页", async () => {
    const start = vi
      .fn()
      .mockRejectedValueOnce(new PickupError(403, "link_password_invalid", "口令错误", {}))
      .mockRejectedValueOnce(new PickupError(429, "link_password_locked", "锁定", { retry_after_at: nowSec() + 900 }))
      .mockRejectedValueOnce(new PickupError(403, "link_device_limit", "设备已满", { public_note: "找我" }));
    const statusFn = vi.fn().mockResolvedValueOnce(needsStart({ requires_password: true })).mockResolvedValue(status({ state: "device_limit", visitor_registered: false, public_note: "找我" }));
    const root = await open(fakeApi({ status: statusFn, start }));
    await typeInto(root.querySelector('input[type="password"]') as HTMLInputElement, "wrongpw");
    await click(buttonByText(root, "开始取码"));
    await settle();
    expect(root.textContent).toContain("访问口令不正确");
    expect(root.textContent).toContain("link_password_invalid · HTTP 403");
    await click(buttonByText(root, "开始取码"));
    await settle();
    expect(root.textContent).toContain("口令错误次数过多");
    expect(root.textContent).toContain("12:15");
    await click(buttonByText(root, "开始取码"));
    await settle();
    expect(root.textContent).toContain("这个链接已在其他设备上使用");
    expect(root.textContent).toContain("找我");
  });

  it("不需要人机验证：不加载 Turnstile 脚本，直接可开始", async () => {
    const api = fakeApi({ status: vi.fn(async () => needsStart()) });
    const root = await open(api);
    expect(loadTurnstile).not.toHaveBeenCalled();
    expect(buttonByText(root, "开始取码").disabled).toBe(false);
    await click(buttonByText(root, "开始取码"));
    await settle();
    expect(api.start).toHaveBeenCalledWith(TOKEN, {});
  });

  function fakeTurnstile() {
    const captured: { options: TurnstileRenderOptions | null } = { options: null };
    const widget = {
      render: vi.fn((_el: HTMLElement, o: TurnstileRenderOptions) => {
        captured.options = o;
        return "w1";
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    } satisfies TurnstileApi;
    loadTurnstile.mockResolvedValue(widget);
    return { captured, widget };
  }
  const emitToken = (captured: { options: TurnstileRenderOptions | null }, token: string) => act(async () => captured.options?.callback(token));
  const turnstileStatus = () => needsStart({ requires_turnstile: true, turnstile: { required: true, site_key: "SITEKEY" } });

  it("需要人机验证：进入这一步才加载脚本（action=pickup），通过前禁用，提交带 token", async () => {
    const { captured, widget } = fakeTurnstile();
    const api = fakeApi({ status: vi.fn(async () => turnstileStatus()) });
    const root = await open(api);
    expect(loadTurnstile).toHaveBeenCalledTimes(1);
    expect(widget.render.mock.calls[0]?.[1]).toMatchObject({ sitekey: "SITEKEY", action: "pickup" });
    expect(buttonByText(root, "开始取码").disabled).toBe(true);
    await emitToken(captured, "cf-token-1");
    expect(buttonByText(root, "开始取码").disabled).toBe(false);
    await click(buttonByText(root, "开始取码"));
    await settle();
    expect(api.start).toHaveBeenCalledWith(TOKEN, { turnstile_token: "cf-token-1" });
  });

  it("人机验证失败后 token 作废：控件重置，必须重新验证", async () => {
    const { captured, widget } = fakeTurnstile();
    const start = vi.fn().mockRejectedValueOnce(new PickupError(400, "turnstile_failed", "未通过", {})).mockResolvedValueOnce(status());
    const root = await open(fakeApi({ status: vi.fn(async () => turnstileStatus()), start }));
    await emitToken(captured, "cf-token-1");
    await click(buttonByText(root, "开始取码"));
    await settle();
    expect(root.textContent).toContain("人机验证未通过");
    expect(widget.reset).toHaveBeenCalledWith("w1");
    expect(buttonByText(root, "开始取码").disabled).toBe(true);
    await emitToken(captured, "cf-token-2");
    await click(buttonByText(root, "开始取码"));
    await settle();
    expect(start).toHaveBeenLastCalledWith(TOKEN, { turnstile_token: "cf-token-2" });
  });

  it("人机验证脚本加载失败：就地明确报错，可重试，不降级成无验证", async () => {
    loadTurnstile.mockRejectedValue(new Error("人机验证脚本加载失败（challenges.cloudflare.com 无法访问）"));
    const root = await open(fakeApi({ status: vi.fn(async () => needsStart({ turnstile: { required: true, site_key: "K" } })) }));
    expect(root.textContent).toContain("人机验证脚本加载失败");
    expect(buttonByText(root, "开始取码").disabled).toBe(true);
    expect(buttonByText(root, "重试")).toBeTruthy();
  });

  it("要求人机验证但缺 site key：禁用开始取码并说明，不加载脚本", async () => {
    const root = await open(fakeApi({ status: vi.fn(async () => needsStart({ turnstile: { required: true } })) }));
    expect(loadTurnstile).not.toHaveBeenCalled();
    expect(root.textContent).toContain("turnstile_not_configured");
    expect(buttonByText(root, "开始取码").disabled).toBe(true);
  });
});

describe("code_only 视图", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
  });

  const THREE_CODES = [mail(3, 32, { code: "482910" }), mail(2, 8 * 60, { code: "205117" }), mail(1, 27 * 60, { code: "118342" })];

  it("最新验证码大卡（等宽、逐位朗读、来源与多久前）；较旧弱化；超过 10 分钟标可能已过期", async () => {
    const root = await open(fakeApi({ mails: vi.fn(async () => list(THREE_CODES)) }));
    const latest = root.querySelector(".pk-code-card");
    expect(latest?.querySelector("output")?.textContent).toBe("482910");
    expect(latest?.querySelector("output")?.getAttribute("aria-label")).toBe("验证码 4 8 2 9 1 0");
    expect(latest?.textContent).toContain("32 秒前");
    expect(latest?.textContent).toContain("来自 OpenAI");
    expect(latest?.textContent).not.toContain("可能已过期");
    const older = Array.from(root.querySelectorAll(".pk-old"));
    expect(older.map((o) => o.querySelector(".code")?.textContent)).toEqual(["205117", "118342"]);
    expect(older[0]?.textContent).not.toContain("可能已过期");
    expect(older[1]?.textContent).toContain("收到超过 10 分钟，可能已过期");
  });

  it("底部通栏“复制验证码”复制最新一条", async () => {
    const root = await open(fakeApi({ mails: vi.fn(async () => list(THREE_CODES)) }));
    await click(buttonByText(root.querySelector(".pk-bar") as HTMLElement, "复制验证码"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("482910");
    expect(root.querySelector(".pk-toast")?.textContent).toBe("已复制 482910");
  });

  it("复制失败时明确提示，不假装成功", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("denied"); }) }, configurable: true });
    const root = await open(fakeApi({ mails: vi.fn(async () => list([mail(1, 5, { code: "111222" })])) }));
    await click(buttonByText(root, "复制验证码"));
    expect(root.querySelector(".pk-toast")?.textContent).toBe("复制失败，请长按验证码选择复制");
  });

  it("登录链接：只显示域名；https 才可点（noopener noreferrer）；复制链接", async () => {
    const url = "https://auth.openai.com/u/login?token=SECRET123";
    const root = await open(fakeApi({ mails: vi.fn(async () => list([mail(1, 5, { login_link: url })])) }));
    expect(root.querySelector(".pk-link-domain")?.textContent).toBe("auth.openai.com");
    expect(root.textContent).not.toContain("SECRET123");
    const anchor = root.querySelector(".pk-bar a") as HTMLAnchorElement;
    expect(anchor.textContent).toContain("打开登录链接");
    expect(anchor.getAttribute("href")).toBe(url);
    expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchor.getAttribute("target")).toBe("_blank");
    await click(buttonByText(root, "复制链接"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(url);
  });

  it.each(["javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://x.example/a", "//evil.example/a"])("非 http(s) 链接 %s 不渲染成可点链接", async (bad) => {
    const root = await open(fakeApi({ mails: vi.fn(async () => list([mail(1, 5, { login_link: bad })])) }));
    expect(root.querySelector("a[href]")).toBeNull();
    expect(root.textContent).toContain("已禁止打开");
  });

  it("没有邮件：等待态，不显示复制按钮", async () => {
    const root = await open(fakeApi());
    expect(root.textContent).toContain("正在等待新邮件");
    expect(root.querySelector(".pk-bar")).toBeNull();
  });
});

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

  it("每日次数用尽：locked 的查看按钮禁用并说明", async () => {
    const mails = vi.fn(async () => list([mail(5, 20, { locked: true })]));
    const deliveries = quota({ total_limit: null, total_remaining: null, daily_limit: 3, daily_used: 3, daily_remaining: 0 });
    const root = await open(fakeApi({ status: vi.fn(async () => status({ reveal: "click", deliveries })), mails }));
    expect(buttonByText(root, "查看验证码").disabled).toBe(true);
    expect(root.textContent).toContain("取码次数已用完");
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

describe("列表 + 详情视图", () => {
  it("text 视图：列表项 → 详情纯文本，不链接化；meta_only 没有详情", async () => {
    const items = [mail(2, 30, { subject: "你的验证码", snippet: "摘要", sender: { name: "Google" } })];
    const detail = vi.fn(async () => mail(2, 30, { subject: "你的验证码", sender: { name: "Google", address: "no-reply@google.com" }, recipient: "no***@icloud.com", text: "访问 https://x.example.com 获取\n<b>不是标签</b>" }));
    const root = await open(fakeApi({ status: vi.fn(async () => status({ view: "text" })), mails: vi.fn(async () => list(items)), detail }));
    expect(root.querySelector(".pickup-shell")?.getAttribute("data-wide")).toBe("true");
    expect(root.textContent).toContain("1 封邮件");
    await click(root.querySelector("button.pk-item") as HTMLElement);
    await settle();
    expect(detail).toHaveBeenCalledWith(TOKEN, 2);
    const body = root.querySelector(".pk-article .mail-text");
    expect(body?.textContent).toBe("访问 https://x.example.com 获取\n<b>不是标签</b>");
    expect(body?.querySelector("a, b")).toBeNull();
    expect(root.querySelector("iframe")).toBeNull();
    await mounted?.unmount();

    const root2 = await open(fakeApi({ status: vi.fn(async () => status({ view: "meta_only" })), mails: vi.fn(async () => list(items)), detail }));
    expect(root2.querySelector("button.pk-item")).toBeNull();
    expect(root2.querySelector(".pk-detail")).toBeNull();
    expect(root2.textContent).toContain("你的验证码");
  });

  it("full 视图：HTML 正文进沙箱 iframe，属性正好是硬性要求的那两项，srcDoc 原样", async () => {
    const html = '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"></head><body><p>Hi</p>';
    const detail = vi.fn(async () => mail(2, 30, { subject: "主题", html, text: "Hi" }));
    const root = await open(fakeApi({ status: vi.fn(async () => status({ view: "full" })), mails: vi.fn(async () => list([mail(2, 30, { subject: "主题" })])), detail }));
    await click(root.querySelector("button.pk-item") as HTMLElement);
    await settle();
    const frame = root.querySelector("iframe") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("allow-popups allow-popups-to-escape-sandbox");
    expect(MAIL_FRAME_SANDBOX).toBe("allow-popups allow-popups-to-escape-sandbox");
    expect(frame.getAttribute("srcdoc")).toBe(html);
  });

  it("click 模式下列表项显示“有 1 封新邮件，点击查看（剩余 N 次）”，点击先取码再展开详情", async () => {
    const reveal = vi.fn(async () => ({ mail: mail(2, 30, { subject: "主题" }), counted: true, deliveries: quota({ total_used: 1, total_remaining: 1 }) }));
    const detail = vi.fn(async () => mail(2, 30, { subject: "主题", text: "正文" }));
    const root = await open(fakeApi({ status: vi.fn(async () => status({ view: "text", reveal: "click", deliveries: quota() })), mails: vi.fn(async () => list([mail(2, 30, { locked: true })])), reveal, detail }));
    expect(root.querySelector("button.pk-item")?.textContent).toContain("有 1 封新邮件，点击查看（剩余 2 次）");
    await click(root.querySelector("button.pk-item") as HTMLElement);
    await settle();
    expect(reveal).toHaveBeenCalledWith(TOKEN, 2);
    expect(detail).toHaveBeenCalledWith(TOKEN, 2);
    expect(root.querySelector(".pk-article .mail-text")?.textContent).toBe("正文");
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
