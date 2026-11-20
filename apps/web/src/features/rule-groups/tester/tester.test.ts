// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ReactRouter from "@tanstack/react-router";
import type { PresentedMail, RuleGroupTestItem, RuleGroupTestRequest, RuleGroupTestResponse } from "@maillink/shared";
import { TESTER_DEBOUNCE_MS } from "../../../constants";
import { mount } from "../../../test/render";
import type { Mounted } from "../../../test/render";
import { BLANK_CONFIG } from "../config";
import { describeHit, describeReason } from "./reasons";
import { buildTestRequest, parseTarget, summarizeItems } from "./tester-state";
import { TesterResults } from "./TesterResults";
import { preferredAddress } from "./Tester";
import { useRuleGroupTest } from "./useRuleGroupTest";

const testRuleGroup = vi.fn<(body: RuleGroupTestRequest) => Promise<RuleGroupTestResponse>>();
vi.mock("../../../api/instance", () => ({ api: { testRuleGroup: (body: RuleGroupTestRequest) => testRuleGroup(body) } }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  const { createElement: h } = await import("react");
  const Link = ({ to, search, children, ...rest }: { to: string; search?: unknown; children?: unknown }) =>
    h("a", { href: to, "data-search": JSON.stringify(search ?? null), ...rest }, children as never);
  return { ...actual, Link };
});

let mounted: Mounted | null = null;
beforeEach(() => testRuleGroup.mockReset());
afterEach(async () => {
  vi.useRealTimers();
  await mounted?.unmount();
  mounted = null;
});

const NOW = new Date("2026-11-20T12:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);

function item(over: Partial<RuleGroupTestItem>): RuleGroupTestItem {
  return {
    mail_id: 1,
    received_at: nowSec - 30,
    recipient: "alias@icloud.com",
    parse_status: "ok",
    visible: false,
    reason_code: "no_allow_match",
    reason: "no_allow_match",
    matched: [],
    extracted: null,
    preview: null,
    ...over,
  };
}

const response = (items: RuleGroupTestItem[], over: Partial<RuleGroupTestResponse> = {}): RuleGroupTestResponse => ({ items, partial: false, time_lower_bound: null, warnings: [], ...over });

describe("原因码", () => {
  it("每个原因码都有中文说明；deny 红、解析 / 截断 / pending 赭、其余灰", () => {
    const codes = ["allow_match", "blacklist_pass", "deny", "no_allow_match", "out_of_window", "parse_failed", "body_truncated", "no_code", "max_mails", "pending"];
    for (const code of codes) expect(describeReason({ reason_code: code, reason: code }).text, code).not.toContain("未登记");
    expect(describeReason({ reason_code: "deny", reason: "deny:屏蔽账单" })).toMatchObject({ tag: "deny:屏蔽账单", tone: "danger" });
    for (const code of ["parse_failed", "body_truncated", "pending"]) expect(describeReason({ reason_code: code, reason: code }).tone).toBe("warning");
    for (const code of ["no_allow_match", "out_of_window", "no_code", "max_mails", "allow_match"]) expect(describeReason({ reason_code: code, reason: code }).tone).toBe("neutral");
    expect(describeReason({ reason_code: "future_code", reason: "future_code" }).text).toContain("未登记的原因码 future_code");
  });

  it("命中条件的描述：叶子带字段 / 操作符 / 取值，列表字段带命中的元素，not 单独说明", () => {
    expect(describeHit({ kind: "leaf", path: "when", field: "category", op: "eq", value: "password_reset" })).toBe("邮件分类 等于 password_reset");
    expect(describeHit({ kind: "leaf", path: "when", field: "sender.domain", op: "domain_is", value: "openai.com", candidate: "tm.openai.com" })).toBe("发件人域名 是该域名或子域名 openai.com（命中：tm.openai.com）");
    expect(describeHit({ kind: "leaf", path: "when", field: "code.present", op: "is", value: "true" })).toBe("提取到验证码：是");
    expect(describeHit({ kind: "not", path: "when.not" })).toContain("not 条件成立");
  });
});

describe("测试目标", () => {
  it("地址 → addresses；数字（可逗号 / 空白分隔）→ mail_ids；空串不报错；非法报原因", () => {
    expect(parseTarget("  alias@icloud.com ")).toEqual({ ok: true, target: { kind: "addresses", addresses: ["alias@icloud.com"] } });
    expect(parseTarget("12, 13 13")).toEqual({ ok: true, target: { kind: "mail_ids", mailIds: [12, 13] } });
    expect(parseTarget("")).toEqual({ ok: false, error: null });
    expect(parseTarget("0")).toEqual({ ok: false, error: "邮件 id 必须是正整数" });
    expect(parseTarget(Array.from({ length: 51 }, (_, i) => i + 1).join(","))).toMatchObject({ ok: false });
  });

  it("请求体：addresses 与 mail_ids 二选一；锚点时间可选", () => {
    expect(buildTestRequest({ a: 1 }, { kind: "addresses", addresses: ["x@y.z"] }, undefined)).toEqual({ config: { a: 1 }, addresses: ["x@y.z"] });
    expect(buildTestRequest({ a: 1 }, { kind: "mail_ids", mailIds: [3] }, 1_700_000_000)).toEqual({ config: { a: 1 }, mail_ids: [3], anchor_at: 1_700_000_000 });
  });

  it("预选地址：最近来过信的；都没来过信取第一个", () => {
    expect(preferredAddress(undefined)).toBeUndefined();
    expect(preferredAddress([{ address: "a", last_received_at: null }, { address: "b", last_received_at: 5 }, { address: "c", last_received_at: 9 }])).toBe("c");
    expect(preferredAddress([{ address: "a", last_received_at: null }, { address: "b", last_received_at: null }])).toBe("a");
  });
});

const text = (element: Element): string => element.textContent ?? "";
function one(root: Element, selector: string): Element {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`找不到 ${selector}`);
  return found;
}

describe("结果渲染", () => {
  const preview: PresentedMail = { id: 1, received_at: nowSec, sender: { domain: "openai.com" }, recipient: "al***@icloud.com", subject: "你的验证码是 482910", code: "482910", login_link: "javascript:alert(1)" };

  function render(result: RuleGroupTestResponse, extra: { stale?: boolean } = {}) {
    return mount(createElement(TesterResults, { result, stale: extra.stale ?? false, busy: false, now: NOW, onRerun: vi.fn() }));
  }

  it("汇总 + 逐封：可见 / 不可见、原因码与中文说明、命中规则与条件、提取到的验证码", async () => {
    const items = [
      item({ mail_id: 11, visible: true, reason_code: "allow_match", reason: "allow:含验证码", matched: [{ rule_id: "r1", rule_name: "含验证码", effect: "allow", hits: [{ kind: "leaf", path: "when", field: "code.present", op: "is", value: "true" }] }], extracted: { code: "482910", code_origin: "builtin", code_steps: [], login_link: null }, preview }),
      item({ mail_id: 12, reason_code: "deny", reason: "deny:屏蔽账单", matched: [{ rule_id: "r2", rule_name: "屏蔽账单", effect: "deny", hits: [{ kind: "leaf", path: "when", field: "category", op: "eq", value: "billing" }] }] }),
      item({ mail_id: 13, parse_status: "failed", reason_code: "parse_failed", reason: "parse_failed" }),
      item({ mail_id: 14, reason_code: "body_truncated", reason: "body_truncated" }),
      item({ mail_id: 15, reason_code: "out_of_window", reason: "out_of_window" }),
      item({ mail_id: 16, parse_status: "pending", reason_code: "pending", reason: "pending" }),
    ];
    mounted = await render(response(items, { partial: true, time_lower_bound: nowSec - 600 }));
    const root = mounted.container;
    const sum = text(one(root, ".tester-sum"));
    expect(sum).toContain("最近 6 封");
    expect(sum).toContain("可见 1");
    expect(sum).toContain("不可见 5");
    const rows = Array.from(root.querySelectorAll<HTMLElement>(".t-item"));
    expect(rows).toHaveLength(6);
    const row = (i: number): HTMLElement => {
      const found = rows[i];
      if (!found) throw new Error(`没有第 ${i} 行`);
      return found;
    };
    expect(text(row(0))).toContain("可见");
    expect(text(row(0))).toContain("allow:含验证码");
    expect(text(row(0))).toContain("提取到 482910（内置提取）");
    expect(text(row(0))).toContain("提取到验证码：是");
    expect(text(one(row(0), ".t-subject"))).toBe("你的验证码是 482910");
    const tone = (i: number) => row(i).querySelector(".t-reason .tag")?.getAttribute("data-tone") ?? null;
    expect(tone(1)).toBe("danger");
    expect(text(row(1))).toContain("deny:屏蔽账单");
    expect(text(row(1))).toContain("邮件分类 等于 billing");
    expect(tone(2)).toBe("warning");
    expect(tone(3)).toBe("warning");
    expect(text(row(3))).toContain("正文超长，无法完整判定");
    expect(tone(4)).toBeNull();
    expect(text(row(4))).toContain("超出时间范围");
    expect(text(row(5))).toContain("稍后会补上");
    expect(text(root)).toContain("有效时间下界");
    expect(text(root)).toContain("有邮件本次没解析到");
    // 邮件 id 链到“全部邮件”该封
    expect(JSON.parse(one(row(0), "a.t-id").getAttribute("data-search") ?? "null")).toEqual({ id: 11 });
  });

  it("访客视角预览：点开才看；验证码、主题按纯文本；非 http(s) 的登录链接不渲染成链接", async () => {
    mounted = await render(response([item({ mail_id: 1, visible: true, reason_code: "allow_match", reason: "allow:r", preview })]));
    const details = mounted.container.querySelector<HTMLDetailsElement>("details.t-preview-toggle");
    expect(details?.open).toBe(false);
    const box = details?.querySelector(".t-preview");
    expect(box?.querySelector(".pv-code")?.textContent).toBe("482910");
    expect(box?.textContent).toContain("你的验证码是 482910");
    expect(box?.querySelector("a")).toBeNull();
    expect(box?.querySelector(".pv-link")?.textContent).toBe("javascript:alert(1)");
  });

  it("http(s) 登录链接才是链接，带 rel=noopener noreferrer", async () => {
    mounted = await render(response([item({ visible: true, reason_code: "allow_match", reason: "allow:r", preview: { ...preview, login_link: "https://auth.example.com/x?t=1" } })]));
    const link = mounted.container.querySelector<HTMLAnchorElement>(".t-preview a");
    expect(link?.getAttribute("href")).toBe("https://auth.example.com/x?t=1");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("不可见的邮件没有预览；没有邮件时说明", async () => {
    mounted = await render(response([item({})]));
    expect(mounted.container.querySelector("details")).toBeNull();
    await mounted.render(createElement(TesterResults, { result: response([]), stale: false, busy: false, now: NOW, onRerun: vi.fn() }));
    expect(mounted.container.textContent).toContain("没有邮件可以试跑");
  });

  it("汇总计数", () => {
    expect(summarizeItems([item({ visible: true }), item({}), item({})])).toEqual({ total: 3, visible: 1, hidden: 2 });
  });
});

describe("防抖重跑", () => {
  function Harness({ config, target }: { config: unknown; target: string }) {
    const test = useRuleGroupTest(config, target, undefined);
    return createElement("output", { "data-pending": String(test.pending), "data-blocking": String(test.blocking) }, test.query.data ? `items=${test.query.data.items.length}` : "none");
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("首次立即试跑；之后配置连续改动期间不发请求，停手 600ms 后只用最新配置发一次", async () => {
    vi.useFakeTimers();
    testRuleGroup.mockResolvedValue(response([item({})]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (config: unknown, target = "alias@icloud.com") => createElement(QueryClientProvider, { client }, createElement(Harness, { config, target }));
    const withWindow = (minutes: number) => ({ ...BLANK_CONFIG, time: { window_minutes: minutes, since: { type: "none" as const } } });

    // 首次打开页面立刻试跑一次（没有“改动”可等）
    mounted = await mount(wrap(withWindow(10)));
    await advance(0);
    expect(testRuleGroup).toHaveBeenCalledTimes(1);
    expect(testRuleGroup.mock.calls[0]?.[0]).toMatchObject({ addresses: ["alias@icloud.com"], config: { time: { window_minutes: 10 } } });
    expect(mounted.container.textContent).toBe("items=1");

    await mounted.render(wrap(withWindow(11)));
    expect(mounted.container.querySelector("output")?.getAttribute("data-pending")).toBe("true");
    await advance(300);
    await mounted.render(wrap(withWindow(12)));
    await advance(300);
    await mounted.render(wrap(withWindow(13)));
    await advance(TESTER_DEBOUNCE_MS - 1);
    expect(testRuleGroup).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(testRuleGroup).toHaveBeenCalledTimes(2);
    expect(testRuleGroup.mock.calls[1]?.[0]).toMatchObject({ config: { time: { window_minutes: 13 } } });
    expect(mounted.container.querySelector("output")?.getAttribute("data-pending")).toBe("false");
  });

  it("配置本地校验有错误：不发请求（服务端会同样拒绝），保留上一份结果；没填目标也不发", async () => {
    vi.useFakeTimers();
    testRuleGroup.mockResolvedValue(response([item({}), item({ mail_id: 2 })]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (config: unknown, target: string) => createElement(QueryClientProvider, { client }, createElement(Harness, { config, target }));
    mounted = await mount(wrap(BLANK_CONFIG, ""));
    await advance(TESTER_DEBOUNCE_MS + 10);
    expect(testRuleGroup).not.toHaveBeenCalled();

    await mounted.render(wrap(BLANK_CONFIG, "alias@icloud.com"));
    await advance(TESTER_DEBOUNCE_MS + 10);
    expect(testRuleGroup).toHaveBeenCalledTimes(1);

    await mounted.render(wrap({ ...BLANK_CONFIG, limits: { max_mails: 0 } }, "alias@icloud.com"));
    await advance(TESTER_DEBOUNCE_MS + 10);
    expect(testRuleGroup).toHaveBeenCalledTimes(1);
    const out = mounted.container.querySelector("output");
    expect(out?.getAttribute("data-blocking")).toBe("1");
    expect(out?.textContent).toBe("items=2");
  });
});
