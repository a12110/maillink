// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminMailboxTagsQuery, queryKeys } from "../../api/queries";
import { SEARCH_DEBOUNCE_MS } from "../../constants";
import { installFakeFetch } from "../../test/fake-fetch";
import type { FakeFetch } from "../../test/fake-fetch";
import { mountWithProviders, testQueryClient } from "../../test/providers";
import { selectValue, typeInto } from "../../test/render";
import type { Mounted } from "../../test/render";
import { settle } from "../../test/dom";
import { api } from "../../api/instance";
import { MailboxToolbar } from "./MailboxToolbar";
import { useMailboxList } from "./useMailboxList";

const EMPTY_LIST = { items: [], next_cursor: null, total: 0, active_count: 0, disabled_count: 0 };
const TAGS = { items: [{ tag: "OpenAI", count: 12 }, { tag: "GitHub", count: 3 }], truncated: false };

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

function Harness() {
  const state = useMailboxList();
  return createElement(MailboxToolbar, { filters: state.filters, tags: state.tags, tagError: state.tagError, onChange: state.changeFilters, onImport: () => undefined });
}

async function open(tags: unknown = TAGS): Promise<FakeFetch> {
  const server = installFakeFetch({
    "GET /api/admin/mailboxes": { json: EMPTY_LIST },
    "GET /api/admin/mailboxes/tags": { json: tags },
  });
  mounted = await mountWithProviders(createElement(Harness));
  await settle();
  return server;
}

function listParams(server: FakeFetch): URLSearchParams[] {
  return server.callsTo("GET /api/admin/mailboxes").map((call) => new URL(call.url, "http://x").searchParams);
}

function select(label: string): HTMLSelectElement {
  const found = mounted?.container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (!found) throw new Error(`找不到 ${label}`);
  return found;
}

describe("标签清单接口与查询", () => {
  it("请求 /tags 并按 schema 解析", async () => {
    const server = installFakeFetch({ "GET /api/admin/mailboxes/tags": { json: TAGS } });
    await expect(api.listMailboxTags()).resolves.toEqual(TAGS);
    expect(server.calls.map((call) => call.url)).toEqual(["/api/admin/mailboxes/tags"]);
    vi.unstubAllGlobals();
  });

  it("响应不符合 schema 时抛错，不静默", async () => {
    installFakeFetch({ "GET /api/admin/mailboxes/tags": { json: { items: [{ tag: "a" }], truncated: false } } });
    await expect(api.listMailboxTags()).rejects.toThrow();
    vi.unstubAllGlobals();
  });

  it("键挂在 adminMailboxes 下：导入、改标签、批量后的 invalidate 会让它失效", async () => {
    const client = testQueryClient();
    installFakeFetch({ "GET /api/admin/mailboxes/tags": { json: TAGS } });
    await client.fetchQuery(adminMailboxTagsQuery());
    expect(client.getQueryState(adminMailboxTagsQuery().queryKey)?.isInvalidated).toBe(false);
    await client.invalidateQueries({ queryKey: queryKeys.adminMailboxes });
    expect(client.getQueryState(adminMailboxTagsQuery().queryKey)?.isInvalidated).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("收件地址工具栏筛选", () => {
  it("候选带使用次数", async () => {
    await open();
    const options = [...(mounted?.container.querySelectorAll("datalist option") ?? [])].map((o) => [o.getAttribute("value"), o.getAttribute("label")]);
    expect(options).toEqual([["OpenAI", "OpenAI（12）"], ["GitHub", "GitHub（3）"]]);
    expect(mounted?.container.textContent).not.toContain("只列出最常用");
  });

  it("truncated=true 时提示只列出了前 N 个", async () => {
    await open({ ...TAGS, truncated: true });
    expect(mounted?.container.textContent).toContain("只列出最常用的 2 个标签，可直接输入");
  });

  it("链接、状态、标签、搜索组合后发出对应查询参数", async () => {
    const server = await open();
    expect(listParams(server).at(-1)?.has("has_link")).toBe(false);
    await selectValue(select("取件链接筛选"), "without");
    await selectValue(select("状态筛选"), "active");
    const tag = mounted?.container.querySelector<HTMLInputElement>('input[aria-label="标签筛选"]');
    const search = mounted?.container.querySelector<HTMLInputElement>('input[type="search"]');
    if (!tag || !search) throw new Error("缺少输入框");
    await typeInto(tag, "OpenAI");
    await typeInto(search, "abc");
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 50));
    await settle();
    const last = listParams(server).at(-1);
    expect(Object.fromEntries(last ?? [])).toMatchObject({ has_link: "false", status: "active", tag: "OpenAI", q: "abc" });
    await selectValue(select("取件链接筛选"), "with");
    await settle();
    expect(listParams(server).at(-1)?.get("has_link")).toBe("true");
    await selectValue(select("取件链接筛选"), "");
    await settle();
    expect(listParams(server).at(-1)?.has("has_link")).toBe(false);
  });
});
