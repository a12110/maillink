// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MailboxImportRequest, MailboxImportResponse } from "@maillink/shared";
import { act } from "react";
import { click, flush, mount, typeInto } from "../../test/render";
import type { Mounted } from "../../test/render";
import { waitUntil } from "../../test/wait";
import { ToastProvider } from "../../ui";
import { ImportDialog } from "./ImportDialog";

const importMailboxes = vi.fn<(body: MailboxImportRequest) => Promise<MailboxImportResponse>>();
vi.mock("../../api/instance", () => ({ api: { importMailboxes: (body: MailboxImportRequest) => importMailboxes(body) } }));

let mounted: Mounted | null = null;
beforeEach(() => importMailboxes.mockReset());
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

const CSV = "a@icloud.com,OpenAI,备注一\nnot-an-email\na@icloud.com";

const PREVIEW: MailboxImportResponse = {
  dry_run: true,
  summary: { new: 1, duplicate: 1, invalid: 1 },
  items: [
    { line: 1, input: "a@icloud.com", address: "a@icloud.com", tags: ["OpenAI", "vip"], note: "备注一", status: "new", reason: null, id: null },
    { line: 2, input: "not-an-email", address: null, tags: [], note: null, status: "invalid", reason: "invalid_format", id: null },
    { line: 3, input: "a@icloud.com", address: "a@icloud.com", tags: [], note: null, status: "duplicate", reason: "duplicate_in_input", id: null },
  ],
};

async function open(onOpenChange = vi.fn()): Promise<void> {
  const tree = createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ToastProvider, null, createElement(ImportDialog, { open: true, onOpenChange })));
  mounted = await mount(tree);
}

const body = () => document.body;
const button = (text: string) => {
  const found = Array.from(body().querySelectorAll("button")).find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`找不到按钮：${text}\n${body().textContent}`);
  return found;
};

/** 点击会触发请求 mock 的 resolve / reject：点完让出几个宏任务，再断言异步渲染的结果 */
async function press(element: Element): Promise<void> {
  await click(element);
  await flush();
}

describe("导入两步对话框", () => {
  it("粘贴 → 预览（dry_run）→ 显示新增 / 重复 / 无效各多少与逐条原因 → 确认才真正写入", async () => {
    importMailboxes.mockResolvedValueOnce(PREVIEW);
    const onOpenChange = vi.fn();
    await open(onOpenChange);
    await typeInto(body().querySelector("textarea") as HTMLTextAreaElement, CSV);
    await press(button("预览导入结果"));

    expect(importMailboxes).toHaveBeenCalledTimes(1);
    expect(importMailboxes).toHaveBeenLastCalledWith({ content: CSV, tags: [], dry_run: true });
    const counts = Array.from(body().querySelectorAll(".import-counts > div")).map((d) => d.textContent);
    expect(counts).toEqual(["新增1", "重复1", "无效1"]);
    // 逐条原因：无效与重复各一组，原因是中文说明
    expect(body().textContent).toContain("不是合法的邮箱地址");
    expect(body().textContent).toContain("本次导入内重复");
    expect(body().textContent).toContain("第 2 行");
    // 预览阶段没有写入
    expect(importMailboxes.mock.calls.every(([request]) => request.dry_run === true)).toBe(true);

    importMailboxes.mockResolvedValueOnce({ ...PREVIEW, dry_run: false });
    await press(button("导入 1 个新地址"));
    expect(importMailboxes).toHaveBeenCalledTimes(2);
    expect(importMailboxes).toHaveBeenLastCalledWith({ content: CSV, tags: [], dry_run: false });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("预览逐条显示解析出的标签与备注（空值为“—”，全文在 title 里），让管理员在确认前看见落位", async () => {
    importMailboxes.mockResolvedValueOnce({ ...PREVIEW, items: [{ ...PREVIEW.items[0]!, tags: ["OpenAI", "vip"], note: "x".repeat(80) }, PREVIEW.items[1]!] });
    await open();
    await typeInto(body().querySelector("textarea") as HTMLTextAreaElement, CSV);
    await press(button("预览导入结果"));
    const field = (label: string) => Array.from(body().querySelectorAll<HTMLElement>(`.import-items [data-field="${label}"]`));
    expect(field("标签").map((el) => el.textContent).sort()).toEqual(["标签：OpenAI、vip", "标签：—"]);
    expect(field("标签").find((el) => el.title)?.title).toBe("OpenAI、vip");
    expect(field("备注").map((el) => el.textContent).sort()).toEqual([`备注：${"x".repeat(80)}`, "备注：—"].sort());
    expect(field("备注").find((el) => el.title)?.title).toBe("x".repeat(80));
  });

  it("上传文件：内容读进文本域并显示文件名，之后照常预览", async () => {
    importMailboxes.mockResolvedValueOnce(PREVIEW);
    await open();
    const fileInput = body().querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error("没有文件输入");
    const file = new File([CSV], "aliases.csv", { type: "text/csv" });
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(body().querySelector("textarea")?.value).toBe(CSV);
    expect(body().textContent).toContain("已读入 aliases.csv");
    await press(button("预览导入结果"));
    expect(importMailboxes).toHaveBeenLastCalledWith({ content: CSV, tags: [], dry_run: true });
  });

  it("没有新增时确认按钮禁用并写明原因；可返回修改", async () => {
    importMailboxes.mockResolvedValueOnce({ ...PREVIEW, summary: { new: 0, duplicate: 2, invalid: 0 }, items: PREVIEW.items.filter((i) => i.status === "duplicate") });
    await open();
    await typeInto(body().querySelector("textarea") as HTMLTextAreaElement, "a@icloud.com");
    await press(button("预览导入结果"));
    const confirm = button("没有可导入的新地址") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await click(button("返回修改"));
    expect(body().querySelector("textarea")?.value).toBe("a@icloud.com");
  });

  it("格式说明与占位示例按 06 §8 的列序：地址, 平台, 备注", async () => {
    await open();
    expect(body().textContent).toContain("地址[,平台[,备注]]");
    expect(body().textContent).toContain("平台列会成为该地址的标签");
    expect(body().querySelector("textarea")?.placeholder).toMatch(/^alias_one@icloud\.com,OpenAI,共享号 #12\n/u);
  });

  it("本地检查不通过时不发请求，就地写明原因", async () => {
    await open();
    await press(button("预览导入结果"));
    expect(importMailboxes).not.toHaveBeenCalled();
    expect(body().textContent).toContain("请粘贴地址");
  });

  it("预览失败：错误就地显示（带错误码），仍停在第 1 步，输入保留", async () => {
    importMailboxes.mockRejectedValueOnce(new Error("boom"));
    await open();
    await typeInto(body().querySelector("textarea") as HTMLTextAreaElement, "a@icloud.com");
    await press(button("预览导入结果"));
    // mockRejectedValueOnce 的拒绝要过几个微任务才渲染出错误提示：等它出现再断言
    await waitUntil(() => body().querySelector('[role="alert"]') !== null, "出现预览失败提示");
    expect(body().querySelector('[role="alert"]')?.textContent).toContain("预览失败");
    expect(body().querySelector("textarea")?.value).toBe("a@icloud.com");
  });
});
