// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRuleGroupDetail, RuleGroupCreate, RuleGroupSaveResponse, RuleGroupUpdate } from "@maillink/shared";
import { ApiError } from "../../../api/errors";
import { click, flush, mount, typeInto } from "../../../test/render";
import type { Mounted } from "../../../test/render";
import { ToastProvider } from "../../../ui";
import { BLANK_CONFIG } from "../config";
import { SaveErrors } from "./SaveErrors";
import { useRuleGroupEditor } from "./useRuleGroupEditor";
import { useSaveRuleGroup } from "./useSaveRuleGroup";
import type { ExistingRuleGroup } from "./useSaveRuleGroup";

const updateRuleGroup = vi.fn<(id: number, body: RuleGroupUpdate) => Promise<RuleGroupSaveResponse>>();
const createRuleGroup = vi.fn<(body: RuleGroupCreate) => Promise<RuleGroupSaveResponse>>();
const getRuleGroup = vi.fn<(id: number) => Promise<AdminRuleGroupDetail>>();
vi.mock("../../../api/instance", () => ({
  api: {
    updateRuleGroup: (id: number, body: RuleGroupUpdate) => updateRuleGroup(id, body),
    createRuleGroup: (body: RuleGroupCreate) => createRuleGroup(body),
    getRuleGroup: (id: number) => getRuleGroup(id),
  },
}));

let mounted: Mounted | null = null;
beforeEach(() => {
  updateRuleGroup.mockReset();
  createRuleGroup.mockReset();
  getRuleGroup.mockReset();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

function detail(over: Partial<AdminRuleGroupDetail> = {}): AdminRuleGroupDetail {
  return {
    id: 1,
    name: "仅验证码",
    description: null,
    schema_version: 1,
    revision: 3,
    invalid: false,
    invalid_code: null,
    view: "text",
    link_count: 2,
    grant_count: 1,
    created_at: 0,
    updated_at: 0,
    config: BLANK_CONFIG,
    issues: [],
    ...over,
  };
}

const EXISTING: ExistingRuleGroup = { id: 1, revision: 3, links: 2, grants: 1 };

function Harness({ existing, onCreated }: { existing: ExistingRuleGroup | null; onCreated: (id: number) => void }) {
  const editor = useRuleGroupEditor({ name: "仅验证码", description: "", config: BLANK_CONFIG });
  const saver = useSaveRuleGroup({ editor, existing, onCreated });
  return createElement(
    "div",
    null,
    createElement("input", { "aria-label": "名称", value: editor.content.name, onChange: (e: { target: { value: string } }) => editor.setName(e.target.value) }),
    createElement("button", { id: "save", onClick: saver.save }, "保存"),
    createElement("output", { id: "state" }, JSON.stringify({ name: editor.content.name, changes: editor.changes, revision: saver.existing?.revision ?? null, issues: editor.issues.length, links: saver.existing?.links ?? null })),
    createElement(SaveErrors, {
      error: saver.error,
      conflict: saver.conflict,
      nameTaken: saver.nameTaken,
      invalidConfig: saver.error instanceof ApiError && saver.error.code === "rule_group_invalid",
      reloading: saver.reloading,
      reloadError: saver.reloadError,
      onReload: saver.reload,
    }),
  );
}

async function open(existing: ExistingRuleGroup | null, onCreated = vi.fn()): Promise<HTMLElement> {
  const tree = createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ToastProvider, null, createElement(Harness, { existing, onCreated })));
  mounted = await mount(tree);
  return mounted.container;
}

const state = (container: HTMLElement) => JSON.parse(container.querySelector("#state")?.textContent ?? "{}") as Record<string, unknown>;
const saveButton = (container: HTMLElement) => container.querySelector("#save") as HTMLButtonElement;

/** 点按钮并等请求结果落定 */
async function press(button: Element | undefined): Promise<void> {
  if (!button) throw new Error("找不到按钮");
  await click(button);
  await flush();
}
const reloadButton = (container: HTMLElement) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("重新加载最新版本"));

describe("保存规则组", () => {
  it("更新带 revision；成功后以服务端返回的内容为新基线（未保存标记归零，revision 前进）", async () => {
    updateRuleGroup.mockResolvedValueOnce({ rule_group: detail({ name: "新名字", revision: 4 }), warnings: [] });
    const container = await open(EXISTING);
    await typeInto(container.querySelector("input") as HTMLInputElement, "新名字");
    expect(state(container)["changes"]).toBe(1);
    await press(saveButton(container));
    expect(updateRuleGroup).toHaveBeenCalledWith(1, { name: "新名字", description: null, config: BLANK_CONFIG, revision: 3 });
    expect(state(container)).toMatchObject({ name: "新名字", changes: 0, revision: 4 });
  });

  it("409 revision_conflict：提示有人已修改并提供重新加载；不丢本地修改、不假装成功", async () => {
    updateRuleGroup.mockRejectedValueOnce(new ApiError(409, "revision_conflict", "规则组已被修改（当前版本 5），请刷新后再保存"));
    const container = await open(EXISTING);
    await typeInto(container.querySelector("input") as HTMLInputElement, "我的修改");
    await press(saveButton(container));
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("已被其他人修改");
    expect(alert?.textContent).toContain("你的修改没有保存");
    expect(state(container)).toMatchObject({ name: "我的修改", changes: 1, revision: 3 });
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.includes("重新加载最新版本"))).toBe(true);
  });

  it("重新加载：用服务器最新内容替换页面（丢弃本地修改），提示消失，之后保存带新的 revision", async () => {
    updateRuleGroup.mockRejectedValueOnce(new ApiError(409, "revision_conflict", "已修改"));
    getRuleGroup.mockResolvedValueOnce(detail({ name: "别人改的名字", revision: 5, link_count: 7 }));
    const container = await open(EXISTING);
    await typeInto(container.querySelector("input") as HTMLInputElement, "我的修改");
    await press(saveButton(container));
    await press(reloadButton(container));
    expect(getRuleGroup).toHaveBeenCalledWith(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(state(container)).toMatchObject({ name: "别人改的名字", changes: 0, revision: 5, links: 7 });

    updateRuleGroup.mockResolvedValueOnce({ rule_group: detail({ revision: 6 }), warnings: [] });
    await typeInto(container.querySelector("input") as HTMLInputElement, "再改");
    await press(saveButton(container));
    expect(updateRuleGroup).toHaveBeenLastCalledWith(1, expect.objectContaining({ revision: 5 }));
  });

  it("重新加载失败：错误就地显示，仍停在冲突提示上", async () => {
    updateRuleGroup.mockRejectedValueOnce(new ApiError(409, "revision_conflict", "已修改"));
    getRuleGroup.mockRejectedValueOnce(new ApiError(500, "internal_error", "服务器出错"));
    const container = await open(EXISTING);
    await press(saveButton(container));
    await press(reloadButton(container));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("重新加载失败：服务器出错");
  });

  it("400 rule_group_invalid：服务端的 issues（如正则试跑过慢）并入问题清单，不再重复弹一个泛泛的错误", async () => {
    updateRuleGroup.mockRejectedValueOnce(
      new ApiError(400, "rule_group_invalid", "规则组配置不合法", {
        issues: [{ code: "regex_too_slow", severity: "error", path: ["present", "code_regex"], message: "试跑过慢" }],
        warnings: [],
      }),
    );
    const container = await open(EXISTING);
    expect(state(container)["issues"]).toBe(1);
    await press(saveButton(container));
    expect(state(container)["issues"]).toBe(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("其他错误：带错误码就地显示", async () => {
    updateRuleGroup.mockRejectedValueOnce(new ApiError(500, "internal_error", "服务器出错"));
    const container = await open(EXISTING);
    await press(saveButton(container));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("internal_error");
  });

  it("新建：POST 不带 revision，成功后通知跳转到新规则组", async () => {
    createRuleGroup.mockResolvedValueOnce({ rule_group: detail({ id: 9 }), warnings: [] });
    const onCreated = vi.fn();
    const container = await open(null, onCreated);
    await press(saveButton(container));
    expect(createRuleGroup).toHaveBeenCalledWith({ name: "仅验证码", description: null, config: BLANK_CONFIG });
    expect(onCreated).toHaveBeenCalledWith(9);
  });
});
