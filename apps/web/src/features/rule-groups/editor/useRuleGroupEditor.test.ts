// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ReactRouter from "@tanstack/react-router";
import { RULE_GROUP_API_LIMITS, RULE_GROUP_LIMITS } from "@maillink/shared";
import { click, mount, typeInto } from "../../../test/render";
import type { Mounted } from "../../../test/render";
import { BLANK_CONFIG, newRule } from "../config";
import { EditorHeader } from "./EditorHeader";
import { saveBlockedReason } from "./RuleGroupEditor";
import { RuleCard } from "./RuleCard";
import { useRuleGroupEditor } from "./useRuleGroupEditor";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  const { createElement: h } = await import("react");
  const Link = ({ to, children, ...rest }: { to: string; children?: unknown }) => h("a", { href: to, ...rest }, children as never);
  return { ...actual, Link };
});

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

function Harness({ unreadable = false }: { unreadable?: boolean }) {
  const editor = useRuleGroupEditor({ name: "n", description: "", config: BLANK_CONFIG }, { unreadable });
  return createElement(
    "div",
    null,
    createElement("textarea", { "aria-label": "json", value: editor.jsonText, onChange: (e: { target: { value: string } }) => editor.editJson(e.target.value) }),
    createElement("button", { id: "to-json", onClick: () => editor.switchMode("json") }, "json"),
    createElement("button", { id: "discard", onClick: editor.discard }, "discard"),
    createElement("button", { id: "rebase", onClick: () => editor.rebase({ name: "n", description: "", config: BLANK_CONFIG }) }, "rebase"),
    createElement("output", null, JSON.stringify({ changes: editor.changes, jsonError: editor.jsonError !== null, text: editor.jsonText.length })),
  );
}

const state = (root: HTMLElement) => JSON.parse(root.querySelector("output")?.textContent ?? "{}") as { changes: number; jsonError: boolean; text: number };

describe("JSON 模式的未保存与保存阻止", () => {
  it("语法错误：算 1 处未保存；放弃更改恢复文本与配置", async () => {
    mounted = await mount(createElement(Harness));
    const root = mounted.container;
    await click(root.querySelector("#to-json") as Element);
    const area = root.querySelector("textarea") as HTMLTextAreaElement;
    const original = area.value;
    expect(state(root)).toMatchObject({ changes: 0, jsonError: false });
    await typeInto(area, '{ "time": ');
    expect(state(root)).toMatchObject({ changes: 1, jsonError: true });
    await click(root.querySelector("#discard") as Element);
    expect(state(root)).toMatchObject({ changes: 0, jsonError: false });
    expect((root.querySelector("textarea") as HTMLTextAreaElement).value).toBe(original);
  });

  it("保存按钮的禁用原因：JSON 语法错误优先，其次问题数，其次没有改动", () => {
    expect(saveBlockedReason(0, true, true, "JSON 语法错误：x")).toBe("JSON 有语法错误，修好后才能保存");
    expect(saveBlockedReason(2, true, true, null)).toBe("有 2 个问题需要先解决");
    expect(saveBlockedReason(0, true, false, null)).toBe("没有改动");
    expect(saveBlockedReason(0, false, false, null)).toBeNull();
    expect(saveBlockedReason(0, true, true, null)).toBeNull();
  });
});

describe("库里的配置不是合法 JSON", () => {
  it("算作有改动（允许直接保存覆盖）；放弃更改不清掉它；保存成功（rebase）后才归零", async () => {
    mounted = await mount(createElement(Harness, { unreadable: true }));
    const root = mounted.container;
    expect(state(root).changes).toBe(1);
    await click(root.querySelector("#discard") as Element);
    expect(state(root).changes).toBe(1);
    await click(root.querySelector("#rebase") as Element);
    expect(state(root).changes).toBe(0);
  });
});

describe("名称长度上限与接口一致", () => {
  it("规则组名称 = nameMaxLength，规则名称 = maxNameLength", async () => {
    mounted = await mount(createElement(EditorHeader, { name: "x", nameError: null, usage: null, changes: 0, saving: false, saveBlockedReason: null, onName: () => undefined, onDiscard: () => undefined, onSave: () => undefined }));
    expect(mounted.container.querySelector("input.editor-name")?.getAttribute("maxlength")).toBe(String(RULE_GROUP_API_LIMITS.nameMaxLength));
    await mounted.render(createElement(RuleCard, { rule: newRule([], "deny"), index: 0, mode: "whitelist", issues: [], onChange: () => undefined, onRemove: () => undefined, onDuplicate: () => undefined, onOpenJson: () => undefined }));
    expect(mounted.container.querySelector("input.rule-name")?.getAttribute("maxlength")).toBe(String(RULE_GROUP_LIMITS.maxNameLength));
  });
});
