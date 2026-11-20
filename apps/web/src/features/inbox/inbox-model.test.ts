import { describe, expect, it } from "vitest";
import type { MyMailbox, MyMailListItem } from "@maillink/shared";
import {
  buildOptions,
  canOpenDetail,
  detailMailboxId,
  isCodeItem,
  loginLinkHost,
  presentedSender,
  resolveScope,
  scopeUnavailableReason,
  viewHasDetail,
} from "./inbox-model";
import { parseInboxSearch } from "./search";
import { formatAgo, isStaleCode } from "./time-ago";

function box(id: number, overrides: Partial<MyMailbox> = {}): MyMailbox {
  return {
    grant_id: id * 10, mailbox_id: id, address: `a${id}@x.com`, label: null, recipient: "full", view: "full",
    expires_at: null, available: true, ...overrides,
  };
}
const FULL = box(1);
const CODE_ONLY = box(2, { view: "code_only" });
const META_ONLY = box(3, { view: "meta_only" });
const HIDDEN = box(4, { address: null, recipient: "hidden", view: "text" });
const BROKEN = box(5, { address: null, label: null, recipient: null, view: null, available: false });
const ALL = [FULL, CODE_ONLY, META_ONLY, HIDDEN, BROKEN];

const row: MyMailListItem = { id: 1, received_at: 1, subject: "你好", sender: { name: "X" }, mailbox_id: 1, view: "full" };
const card: MyMailListItem = { id: 2, received_at: 1, code: "123456", mailbox_id: 2, view: "code_only" };

describe("邮箱切换的选项", () => {
  it("第一项是“全部”（只数可用的），不可用的灰显并提示联系管理员，地址隐藏的写“地址已隐藏”", () => {
    const options = buildOptions(ALL);
    expect(options[0]).toEqual({ value: "all", label: "全部邮箱（4）", disabled: false });
    expect(options.find((o) => o.value === "1")).toEqual({ value: "1", label: "a1@x.com", disabled: false });
    expect(options.find((o) => o.value === "4")).toMatchObject({ label: "地址已隐藏（1）", disabled: false });
    expect(options.find((o) => o.value === "5")).toMatchObject({ disabled: true });
    expect(options.find((o) => o.value === "5")?.label).toContain("请联系管理员");
  });

  it("名称与地址不同时一起显示；不泄露被隐藏的地址", () => {
    expect(buildOptions([box(1, { label: "工作" })])[1]?.label).toBe("工作 · a1@x.com");
    const hidden = buildOptions([box(4, { address: null, label: null, recipient: "hidden" })]);
    expect(hidden[1]?.label).toBe("地址已隐藏（1）");
  });
});

describe("范围解析与 mailbox_id", () => {
  it("没有 mailbox → 全部；有 → 对应邮箱；找不到 → missing", () => {
    expect(resolveScope(ALL, undefined)).toEqual({ kind: "all" });
    expect(resolveScope(ALL, 2)).toEqual({ kind: "mailbox", mailbox: CODE_ONLY });
    expect(resolveScope(ALL, 99)).toEqual({ kind: "missing", mailboxId: 99 });
  });

  it("详情接口的 mailbox_id：单个邮箱带，“全部”不带", () => {
    expect(detailMailboxId({ kind: "mailbox", mailbox: FULL })).toBe(1);
    expect(detailMailboxId({ kind: "all" })).toBeUndefined();
  });

  it("不可用的邮箱 / 已不在授权里 / 全部都不可用：给出原因，不请求", () => {
    expect(scopeUnavailableReason({ kind: "mailbox", mailbox: BROKEN }, ALL)).toContain("联系管理员");
    expect(scopeUnavailableReason({ kind: "missing", mailboxId: 9 }, ALL)).toContain("不在你的授权里");
    expect(scopeUnavailableReason({ kind: "all" }, [BROKEN])).toContain("联系管理员");
    expect(scopeUnavailableReason({ kind: "all" }, ALL)).toBeNull();
    expect(scopeUnavailableReason({ kind: "mailbox", mailbox: FULL }, ALL)).toBeNull();
  });
});

describe("详情入口：code_only / meta_only 没有", () => {
  it("只有 full / text 视图有详情", () => {
    expect(viewHasDetail("full")).toBe(true);
    expect(viewHasDetail("text")).toBe(true);
    expect(viewHasDetail("code_only")).toBe(false);
    expect(viewHasDetail("meta_only")).toBe(false);
    expect(viewHasDetail(null)).toBe(false);
  });

  it("只看条目自带的 view：full / text 有详情，code_only / meta_only 没有（“全部”里各按各的授权，不再按地址猜）", () => {
    expect(canOpenDetail({ ...row, view: "full" })).toBe(true);
    expect(canOpenDetail({ ...row, view: "text" })).toBe(true);
    expect(canOpenDetail({ ...row, view: "meta_only" })).toBe(false);
    expect(canOpenDetail({ ...card, view: "code_only" })).toBe(false);
    // 收件地址显示的是另一个邮箱也不影响：以 view 为准
    expect(canOpenDetail({ ...row, recipient: "a3@x.com", view: "full" })).toBe(true);
  });

  it("locked 条目永远没有详情入口", () => {
    expect(canOpenDetail({ id: 3, received_at: 1, locked: true, mailbox_id: 1, view: "full" })).toBe(false);
  });

  it("验证码卡片：view 为 code_only 且未 locked（即使这封没提取到验证码）", () => {
    expect(isCodeItem(card)).toBe(true);
    expect(isCodeItem({ id: 4, received_at: 1, mailbox_id: 2, view: "code_only", login_link: "https://a.example/x" })).toBe(true);
    expect(isCodeItem({ id: 5, received_at: 1, mailbox_id: 2, view: "code_only" })).toBe(true);
    expect(isCodeItem({ id: 6, received_at: 1, mailbox_id: 2, view: "code_only", locked: true })).toBe(false);
    expect(isCodeItem(row)).toBe(false);
    expect(isCodeItem({ ...row, code: "123456" })).toBe(false);
  });
});

describe("发件人与登录链接", () => {
  it("名称 + 地址、地址、名称、域名依次回退，全隐藏为 null", () => {
    expect(presentedSender({ name: "X", address: "x@a.com" })).toBe("X <x@a.com>");
    expect(presentedSender({ domain: "a.com" })).toBe("a.com");
    expect(presentedSender({ name: "X" })).toBe("X");
    expect(presentedSender(undefined)).toBeNull();
  });

  it("登录链接只给域名；非 http(s) 或解析失败不给", () => {
    expect(loginLinkHost("https://auth.openai.com/login?token=secret")).toBe("auth.openai.com");
    expect(loginLinkHost("javascript:alert(1)")).toBeNull();
    expect(loginLinkHost("https://")).toBeNull();
  });
});

describe("多久之前与 10 分钟", () => {
  it("秒 / 分 / 时 / 天", () => {
    expect(formatAgo(100, 102)).toBe("刚刚");
    expect(formatAgo(100, 132)).toBe("32 秒前");
    expect(formatAgo(0, 300)).toBe("5 分钟前");
    expect(formatAgo(0, 7200)).toBe("2 小时前");
    expect(formatAgo(0, 172_800)).toBe("2 天前");
    expect(formatAgo(500, 100)).toBe("刚刚");
  });

  it("超过 10 分钟算可能已过期", () => {
    expect(isStaleCode(0, 600)).toBe(false);
    expect(isStaleCode(0, 601)).toBe(true);
  });
});

describe("路由查询参数", () => {
  it("只认正整数，其余丢弃", () => {
    expect(parseInboxSearch({ mailbox: "2", id: 7 })).toEqual({ mailbox: 2, id: 7 });
    expect(parseInboxSearch({ mailbox: "0", id: "abc" })).toEqual({});
    expect(parseInboxSearch({ mailbox: "-1" })).toEqual({});
  });
});
