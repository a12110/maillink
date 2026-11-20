// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Rule, RuleGroupConfig } from "@maillink/shared";
import { click, mount, pressKey, selectValue, typeInto } from "../../../test/render";
import type { Mounted } from "../../../test/render";
import { ChipInput } from "../../../ui";
import { BLANK_CONFIG, newRule, templateConfig } from "../config";
import { ExtractField } from "./ExtractField";
import { FilterSection } from "./FilterSection";
import { validateLive } from "./editor-state";
import { NumberField, parseIntegerInput } from "./NumberField";
import { TimeSection } from "./TimeSection";
import { ViewField } from "./ViewField";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

type Update = (c: RuleGroupConfig) => RuleGroupConfig;

function codeOnly(): RuleGroupConfig {
  const found = templateConfig("code_only");
  if (!found) throw new Error("没有模板");
  return found.config;
}

function radio(container: HTMLElement, value: string): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(`input[type=radio][value=${value}]`);
  if (!found) throw new Error(`找不到单选：${value}`);
  return found;
}

describe("互斥约束：当场说明原因，不是悄悄置灰", () => {
  it("有脱敏 / 链接处理时“完整”保留在原位、带锁、点击不切换，并在下方写出原因与解法", async () => {
    const config = codeOnly();
    const onChange = vi.fn<(update: Update) => void>();
    mounted = await mount(createElement(ViewField, { config, issues: validateLive(config), onChange }));
    const full = radio(mounted.container, "full");
    expect(full.getAttribute("aria-disabled")).toBe("true");
    expect(full.disabled).toBe(false);
    expect(full.closest("label")?.querySelector("svg")).not.toBeNull();
    await click(full);
    expect(onChange).not.toHaveBeenCalled();
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("“完整”暂时不能选");
    expect(text).toContain("链接设成了“全部移除”");
    expect(text).toContain("12<b>34</b>");
    expect(text).toContain("把链接改回“保留”");
    // 其他视图可以正常切换
    await click(radio(mounted.container, "text"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0](config).present.view).toBe("text");
  });

  it("没有约束时“完整”可选、不带锁、没有说明", async () => {
    const config: RuleGroupConfig = { ...BLANK_CONFIG, present: { ...BLANK_CONFIG.present, links: "keep" } };
    const onChange = vi.fn<(update: Update) => void>();
    mounted = await mount(createElement(ViewField, { config, issues: [], onChange }));
    const full = radio(mounted.container, "full");
    expect(full.getAttribute("aria-disabled")).toBeNull();
    await click(full);
    expect(onChange.mock.calls[0]?.[0](config).present.view).toBe("full");
    expect(mounted.container.querySelector(".constraint")).toBeNull();
  });

  it("已经是完整视图却又配了脱敏：用 danger 提示块写原因，并提供“删除脱敏规则”", async () => {
    const config: RuleGroupConfig = {
      ...BLANK_CONFIG,
      present: { ...BLANK_CONFIG.present, view: "full", links: "keep", redact: [{ name: "r", match: { type: "text", pattern: "x" }, scope: ["body"], replace: "*" }] },
    };
    const onChange = vi.fn<(update: Update) => void>();
    mounted = await mount(createElement(ViewField, { config, issues: validateLive(config), onChange }));
    expect(mounted.container.querySelector('.callout[data-tone="danger"]')?.textContent).toContain("当前不能用“完整”视图：配置了 1 条脱敏规则");
    const remove = Array.from(mounted.container.querySelectorAll("button")).find((b) => b.textContent === "删除脱敏规则");
    if (remove) await click(remove);
    expect(onChange.mock.calls[0]?.[0](config).present.redact).toEqual([]);
    // 同一问题不在字段下重复列一遍
    expect(mounted.container.querySelectorAll(".field-issues")).toHaveLength(0);
  });

  it("提取登录链接：没限定链接域名时选项禁用并写原因", async () => {
    const config = codeOnly();
    mounted = await mount(createElement(ExtractField, { config, issues: validateLive(config), onChange: vi.fn() }));
    const boxes = Array.from(mounted.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(boxes[0]?.checked).toBe(true);
    expect(boxes[1]?.disabled).toBe(true);
    expect(mounted.container.textContent).toContain("先把“链接”改成只保留指定域名并填入域名");
  });

  it("黑名单模式下“允许”选项被锁并说明；白名单下可选", async () => {
    const blacklist: RuleGroupConfig = { ...BLANK_CONFIG, filter: { mode: "blacklist", rules: [{ ...newRule([], "deny") }] } };
    mounted = await mount(createElement(FilterSection, { config: blacklist, issues: [], onChange: vi.fn(), onOpenJson: vi.fn() }));
    const allow = mounted.container.querySelector<HTMLInputElement>('.rule-card input[type=radio][value="allow"]');
    expect(allow?.getAttribute("aria-disabled")).toBe("true");
    if (allow) await click(allow);
    expect(mounted.container.textContent).toContain("黑名单模式下不能选“允许”");
    expect(Array.from(mounted.container.querySelectorAll("button")).some((b) => b.textContent?.includes("添加允许规则"))).toBe(false);
  });
});

describe("字段就地显示校验问题", () => {
  it("固定时间没填起始时间：错误显示在该字段下", async () => {
    const config: RuleGroupConfig = { ...BLANK_CONFIG, time: { since: { type: "fixed" } } };
    mounted = await mount(createElement(TimeSection, { config, issues: validateLive(config), onChange: vi.fn() }));
    const field = Array.from(mounted.container.querySelectorAll(".field")).find((f) => f.textContent?.includes("起始时间"));
    expect(field?.querySelector(".field-issues")?.textContent).toContain("必须填写 at");
    expect(field?.querySelector("input")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("域名条件：错误精确标到那一个标签上，其余标签正常", async () => {
    const rule: Rule = { id: "a", name: "a", enabled: true, effect: "allow", when: { all: [{ field: "sender.domain", op: "domain_is", value: ["ok.com", "@bad"] }] } };
    const config: RuleGroupConfig = { ...BLANK_CONFIG, filter: { mode: "whitelist", rules: [rule] } };
    mounted = await mount(createElement(FilterSection, { config, issues: validateLive(config), onChange: vi.fn(), onOpenJson: vi.fn() }));
    const chips = Array.from(mounted.container.querySelectorAll<HTMLElement>(".chip"));
    expect(chips.map((c) => c.dataset["invalid"])).toEqual([undefined, "true"]);
    expect(mounted.container.querySelector(".cond-block .field-issues")?.textContent).toContain("不是合法的域名");
  });

  it("选“结尾是”用在域名字段上：写出风险（02 §3.4）", async () => {
    const rule: Rule = { id: "a", name: "a", enabled: true, effect: "allow", when: { all: [{ field: "sender.domain", op: "ends_with", value: ["apple.com"] }] } };
    const config: RuleGroupConfig = { ...BLANK_CONFIG, filter: { mode: "whitelist", rules: [rule] } };
    mounted = await mount(createElement(FilterSection, { config, issues: validateLive(config), onChange: vi.fn(), onOpenJson: vi.fn() }));
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("结尾是（有风险）");
    expect(text).toContain("fakeapple.com");
  });

  it("平台预设：一键把平台的发件人域名追加进取值（已有的不重复）", async () => {
    const rule: Rule = { id: "a", name: "a", enabled: true, effect: "allow", when: { all: [{ field: "sender.domain", op: "domain_is", value: ["openai.com"] }] } };
    const config: RuleGroupConfig = { ...BLANK_CONFIG, filter: { mode: "whitelist", rules: [rule] } };
    const onChange = vi.fn<(update: Update) => void>();
    mounted = await mount(createElement(FilterSection, { config, issues: [], onChange, onOpenJson: vi.fn() }));
    const picker = mounted.container.querySelector<HTMLSelectElement>('select[aria-label^="平台预设"]');
    if (!picker) throw new Error("没有平台预设");
    await selectValue(picker, "openai");
    await selectValue(picker, "anthropic");
    const second = onChange.mock.calls[1]?.[0](config);
    expect(onChange.mock.calls[0]?.[0](config).filter.rules[0]?.when).toEqual({ all: [{ field: "sender.domain", op: "domain_is", value: ["openai.com"] }] });
    expect(JSON.stringify(second?.filter.rules[0]?.when)).toContain("anthropic.com");
  });
});

describe("ChipInput / NumberField", () => {
  it("Enter 与逗号提交，粘贴多行拆成多项，Backspace 删最后一项；regex 模式逗号不拆", async () => {
    const onChange = vi.fn<(values: string[]) => void>();
    mounted = await mount(createElement(ChipInput, { values: ["a"], onChange, "aria-label": "取值" }));
    const input = mounted.container.querySelector("input") as HTMLInputElement;
    await typeInto(input, "b");
    await pressKey(input, "Enter");
    expect(onChange).toHaveBeenLastCalledWith(["a", "b"]);
    await typeInto(input, "c,d");
    await pressKey(input, "Enter");
    expect(onChange).toHaveBeenLastCalledWith(["a", "c", "d"]);
    await typeInto(input, "");
    await pressKey(input, "Backspace");
    expect(onChange).toHaveBeenLastCalledWith([]);

    await mounted.render(createElement(ChipInput, { values: [], onChange, "aria-label": "正则", splitOnComma: false }));
    await typeInto(mounted.container.querySelector("input") as HTMLInputElement, "\\d{4,6}");
    await pressKey(mounted.container.querySelector("input") as HTMLInputElement, "Enter");
    expect(onChange).toHaveBeenLastCalledWith(["\\d{4,6}"]);
  });

  it("整数输入：空 = 未设置；非整数留在输入框并就地报错，不往配置里写", async () => {
    expect(parseIntegerInput("")).toEqual({ value: undefined, error: null });
    expect(parseIntegerInput(" 15 ")).toEqual({ value: 15, error: null });
    expect(parseIntegerInput("1.5").error).toBe("请输入非负整数");
    expect(parseIntegerInput("-3").error).toBe("请输入非负整数");
    const onChange = vi.fn<(value: number | undefined) => void>();
    mounted = await mount(createElement(NumberField, { label: "滚动窗口", value: 10, onChange, suffix: "分钟" }));
    const input = mounted.container.querySelector("input") as HTMLInputElement;
    await typeInto(input, "abc");
    expect(onChange).not.toHaveBeenCalled();
    expect(mounted.container.querySelector(".field-error")?.textContent).toBe("请输入非负整数");
    await typeInto(input, "25");
    expect(onChange).toHaveBeenLastCalledWith(25);
    await typeInto(input, "");
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("外部值变化（如放弃更改）同步回输入框", async () => {
    mounted = await mount(createElement(NumberField, { label: "窗口", value: 10, onChange: vi.fn() }));
    await mounted.render(createElement(NumberField, { label: "窗口", value: 99, onChange: vi.fn() }));
    expect((mounted.container.querySelector("input") as HTMLInputElement).value).toBe("99");
  });
});
