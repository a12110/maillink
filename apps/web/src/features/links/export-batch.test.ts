import { describe, expect, it } from "vitest";
import { buildBatch, describeBatchError, parseExtend, summarizeBatch } from "./batch";
import { buildExportRequest, DEFAULT_TEMPLATE, exportFilename, validateTemplate } from "./export-template";
import { parseLinksSearch } from "./search";
import { reasonText } from "./PanelPreview";

describe("导出行模板", () => {
  it("默认模板合法：{address}----{link}", () => {
    expect(DEFAULT_TEMPLATE).toBe("{address}----{link}");
    expect(validateTemplate(DEFAULT_TEMPLATE)).toBeNull();
    expect(validateTemplate("{address}|{link}|{note}|{name}|{order_ref}")).toBeNull();
  });

  it("不支持的变量、换行、空模板、缺 {link} 给出原因", () => {
    expect(validateTemplate("{address}----{token}")).toContain("{token}");
    expect(validateTemplate("{address}\n{link}")).toContain("换行");
    expect(validateTemplate("  ")).toContain("请填写");
    expect(validateTemplate("{address}")).toContain("{link}");
    expect(validateTemplate("x".repeat(501) + "{link}")).toContain("500");
  });

  it("请求体：CSV 不带 template，模板模式必带", () => {
    expect(buildExportRequest([1, 2], "csv", DEFAULT_TEMPLATE)).toEqual({ ids: [1, 2], format: "csv" });
    expect(buildExportRequest([1, 2], "template", "{address}----{link}")).toEqual({ ids: [1, 2], format: "template", template: "{address}----{link}" });
  });

  it("文件名按格式给扩展名", () => {
    const now = new Date(2026, 10, 20);
    expect(exportFilename("csv", now)).toBe("取件链接-20261120.csv");
    expect(exportFilename("template", now)).toBe("取件链接-20261120.txt");
  });
});

describe("批量操作", () => {
  it("延长：正整数 × 单位，超过 10 年拒绝", () => {
    expect(parseExtend({ amount: "7", unit: "day" })).toEqual({ ok: true, seconds: 7 * 86_400 });
    expect(parseExtend({ amount: "12", unit: "hour" })).toEqual({ ok: true, seconds: 12 * 3600 });
    expect(parseExtend({ amount: "0", unit: "day" })).toMatchObject({ ok: false });
    expect(parseExtend({ amount: "1.5", unit: "day" })).toMatchObject({ ok: false });
    expect(parseExtend({ amount: "3651", unit: "day" })).toMatchObject({ ok: false, error: "最多延长 10 年" });
  });

  it("请求体与后端 schema 的形状一致", () => {
    expect(buildBatch.revoke([1])).toEqual({ ids: [1], action: "revoke" });
    expect(buildBatch.extend([1, 2], 60)).toEqual({ ids: [1, 2], action: "extend", extend_sec: 60 });
    expect(buildBatch.setRuleGroup([3], 9)).toEqual({ ids: [3], action: "set_rule_group", rule_group_id: 9 });
  });

  it("逐条结果：成功数与没改动的原因", () => {
    const summary = summarizeBatch({
      results: [
        { id: 1, ok: true },
        { id: 2, ok: false, error: "link_revoked" },
        { id: 3, ok: false, error: "no_deadline" },
        { id: 4, ok: false, error: "something_new" },
      ],
    });
    expect(summary.ok).toBe(1);
    expect(summary.failed.map((item) => item.id)).toEqual([2, 3, 4]);
    expect(summary.failed[0]?.message).toContain("撤销是终态");
    expect(describeBatchError("something_new")).toBe("something_new");
    expect(describeBatchError(undefined)).toBe("未知原因");
  });
});

describe("路由 search 与预览原因", () => {
  it("筛选参数：数字、枚举、create_for 列表；非法值直接报错", () => {
    expect(parseLinksSearch({ mailbox_id: 5, state: "active", create_for: "1,2,3" })).toMatchObject({ mailbox_id: 5, state: "active", create_for: [1, 2, 3] });
    expect(parseLinksSearch({ create_for: 7 }).create_for).toEqual([7]);
    expect(parseLinksSearch({})).toEqual({});
    expect(() => parseLinksSearch({ state: "nope" })).toThrow("URL 筛选参数不合法");
    expect(() => parseLinksSearch({ create_for: "1,x" })).toThrow();
  });

  it("预览：deny / allow / 其他原因翻成人话", () => {
    expect(reasonText({ visible: false, reason: "deny:屏蔽改密", reason_code: "deny" })).toContain("屏蔽改密");
    expect(reasonText({ visible: true, reason: "allow:含验证码", reason_code: "allow_match" })).toContain("含验证码");
    expect(reasonText({ visible: false, reason: "out_of_window", reason_code: "out_of_window" })).toBe("不在时间范围内");
    expect(reasonText({ visible: false, reason: "max_mails", reason_code: "max_mails" })).toContain("数量上限");
  });
});
