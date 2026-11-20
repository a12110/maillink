// @vitest-environment happy-dom
// 路由级的“URL ↔ 筛选”双向同步要跑真实路由树，TanStack Router 需要 DOM 环境（同 app/router.test.ts）。
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import type { SessionResponse } from "@maillink/shared";
import { createAppRouter } from "../../app/router";
import { queryKeys } from "../../api/queries";
import { MAILS_PAGE_SIZE, PARTIAL_RETRY_DELAYS_MS } from "../../constants";
import {
  applyDraft,
  draftOf,
  filtersKey,
  filtersOf,
  hasActiveFilters,
  localInputToUnix,
  normalizeFilters,
  parseMailsSearch,
  resolveTime,
  toListQuery,
  unixToLocalInput,
} from "./search";

describe("parseMailsSearch", () => {
  it("接受后端同名的筛选参数，数字参数按文本处理", () => {
    expect(parseMailsSearch({ to_address: "A@B.com", address: 12345, source: " s@x.com ", since: "100", until: 200, scope: "unknown", id: "7" })).toEqual({
      to_address: "A@B.com",
      address: "12345",
      source: "s@x.com",
      since: 100,
      until: 200,
      scope: "unknown",
      id: 7,
    });
  });

  it("空串当作没填；没有参数得到空对象", () => {
    expect(parseMailsSearch({ to_address: "", since: "", scope: "" })).toEqual({});
    expect(parseMailsSearch({})).toEqual({});
  });

  it("非法值直接抛错，不静默忽略", () => {
    expect(() => parseMailsSearch({ scope: "nope" })).toThrow(/URL 筛选参数不合法（scope：/);
    expect(() => parseMailsSearch({ since: "abc" })).toThrow();
    expect(() => parseMailsSearch({ id: "0" })).toThrow();
    expect(() => parseMailsSearch({ to_address: "x".repeat(255) })).toThrow();
    expect(() => parseMailsSearch({ since: 200, until: 100 })).toThrow("开始时间不能晚于结束时间");
  });
});

describe("筛选条件", () => {
  it("scope=all 是默认值，不写进 URL，也不算“有筛选”", () => {
    expect(normalizeFilters({ scope: "all", to_address: "a@b.c" })).toEqual({ to_address: "a@b.c" });
    expect(hasActiveFilters({ scope: "all" })).toBe(false);
    expect(hasActiveFilters({ scope: "imported" })).toBe(true);
  });

  it("路由交给页面的 search 里还带着没声明的参数（如 ?theme=dark），不能算作筛选", () => {
    const search = Object.assign(parseMailsSearch({ id: 5 }), { theme: "dark" });
    expect(filtersOf(search)).toEqual({});
    expect(hasActiveFilters(filtersOf(search))).toBe(false);
  });

  it("filtersKey 与键顺序、id 无关；筛选变化才变", () => {
    const a = filtersOf(parseMailsSearch({ to_address: "a@b.c", scope: "unknown", id: 1 }));
    const b = filtersOf(parseMailsSearch({ id: 9, scope: "unknown", to_address: "a@b.c" }));
    expect(filtersKey(a)).toBe(filtersKey(b));
    expect(filtersKey(a)).not.toBe(filtersKey({ ...a, scope: "imported" }));
  });

  it("toListQuery：带上分页大小与游标，scope 默认 all", () => {
    expect(toListQuery({ to_address: "a@b.c" }, "42")).toEqual({
      address: undefined,
      to_address: "a@b.c",
      source: undefined,
      since: undefined,
      until: undefined,
      scope: "all",
      cursor: "42",
      limit: MAILS_PAGE_SIZE,
    });
  });

  it("partial 退避延时是 1s / 2s / 4s（DESIGN.md）", () => {
    expect(PARTIAL_RETRY_DELAYS_MS).toEqual([1000, 2000, 4000]);
  });
});

describe("时间范围与草稿", () => {
  it("本地时间输入 ↔ Unix 秒：开始取整分钟的第 0 秒，结束取第 59 秒，往返稳定", () => {
    const start = localInputToUnix("2026-11-20T09:30", "start");
    const end = localInputToUnix("2026-11-20T09:30", "end");
    if (start === undefined || end === undefined) throw new Error("应能解析");
    expect(end - start).toBe(59);
    expect(unixToLocalInput(start)).toBe("2026-11-20T09:30");
    expect(unixToLocalInput(end)).toBe("2026-11-20T09:30");
    expect(localInputToUnix("", "start")).toBeUndefined();
    expect(localInputToUnix("garbage", "end")).toBeUndefined();
  });

  it("输入框没改动时沿用 URL 里的原始秒数（不被取整）", () => {
    const original = localInputToUnix("2026-11-20T09:30", "start") ?? 0;
    expect(resolveTime(unixToLocalInput(original + 7), original + 7, "start")).toBe(original + 7);
    expect(resolveTime("2026-11-20T09:31", original + 7, "start")).toBe(original + 60);
  });

  it("applyDraft：去空白、空串变 undefined；开始晚于结束与超长不提交", () => {
    const current = { scope: "imported" as const };
    const ok = applyDraft({ ...draftOf({}), to_address: "  a@b.c ", source: "" }, current);
    expect(ok).toEqual({ ok: true, filters: { to_address: "a@b.c", scope: "imported" } });

    const reversed = applyDraft({ ...draftOf({}), since: "2026-11-21T00:00", until: "2026-11-20T00:00" }, {});
    expect(reversed).toEqual({ ok: false, error: "开始时间不能晚于结束时间" });
    expect(applyDraft({ ...draftOf({}), address: "x".repeat(255) }, {}).ok).toBe(false);
  });
});

function session(): SessionResponse {
  return { user: { id: 1, username: "root", display_name: null, email: null, role: "admin" }, auth_methods: ["password"], expires_at: 1 };
}

/** 真实路由树 + 内存 history：URL 就是真相来源 */
async function openMails(url: string) {
  const client = new QueryClient();
  client.setQueryData(queryKeys.session, session());
  client.setQueryData(queryKeys.setupStatus, { needs_setup: false });
  const router = createAppRouter({ client, history: createMemoryHistory({ initialEntries: [url] }) });
  await router.load();
  return router;
}

describe("/admin/mails 的 URL 同步（真实路由树）", () => {
  it("从“该地址的邮件”这类链接直接打开：筛选条件被解析出来", async () => {
    const router = await openMails("/admin/mails?to_address=hme.alias%40icloud.com&scope=unknown&id=12");
    expect(router.state.location.pathname).toBe("/admin/mails");
    const search = router.state.location.search as Record<string, unknown>;
    expect(search).toEqual({ to_address: "hme.alias@icloud.com", scope: "unknown", id: 12 });
    expect(filtersOf(parseMailsSearch(search))).toEqual({ to_address: "hme.alias@icloud.com", scope: "unknown" });
  });

  it("筛选 → URL：导航后地址栏带上规范化的参数；清除后参数消失", async () => {
    const router = await openMails("/admin/mails");
    const filters = normalizeFilters({ address: "x@y.z", since: 1_700_000_000, scope: "imported" });
    await router.navigate({ to: "/admin/mails", search: { ...filters, id: undefined }, replace: true });
    expect(router.state.location.href).toBe("/admin/mails?address=x%40y.z&since=1700000000&scope=imported");
    await router.navigate({ to: "/admin/mails", search: {}, replace: true });
    expect(router.state.location.href).toBe("/admin/mails");
  });

  it("纯数字的邮箱前缀也按文本往返（JSON 解析不会把它变成别的东西）", async () => {
    const router = await openMails("/admin/mails?source=123456");
    const parsed = parseMailsSearch(router.state.location.search as Record<string, unknown>);
    expect(parsed.source).toBe("123456");
  });

  it("URL 参数非法：路由加载失败并暴露原因", async () => {
    const router = await openMails("/admin/mails?scope=bogus");
    expect(router.state.status === "idle" || router.state.status === "pending").toBe(true);
    const match = router.state.matches.find((m) => m.routeId === "/workspace/admin/mails");
    expect(match?.status).toBe("error");
  });
});
