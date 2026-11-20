import { describe, expect, it } from "vitest";
import { expandJsonStrings, hasAuditFilters, toAuditQuery } from "./audit-state";
import { actionLabel, targetLabel } from "./labels";
import type { AuditFilterDraft } from "./AuditFilters";

const NONE: AuditFilterDraft = { action: "", actor: "", since: "", until: "" };

describe("审计筛选 → 查询参数", () => {
  it("空筛选 = 没有参数；动作去空白；执行者转数字", () => {
    expect(toAuditQuery(NONE)).toEqual({ query: { action: undefined, actor_user_id: undefined, since: undefined, until: undefined }, error: null });
    expect(toAuditQuery({ ...NONE, action: " rule_group.update ", actor: "3" }).query).toMatchObject({ action: "rule_group.update", actor_user_id: 3 });
  });

  it("时间范围：开始取该分钟第 0 秒、结束取第 59 秒（含边界）；倒置时给原因、不发请求参数", () => {
    const { query } = toAuditQuery({ ...NONE, since: "2026-11-20T10:00", until: "2026-11-20T10:00" });
    expect((query.until ?? 0) - (query.since ?? 0)).toBe(59);
    expect(toAuditQuery({ ...NONE, since: "2026-11-20T11:00", until: "2026-11-20T10:00" })).toEqual({ query: {}, error: "开始时间不能晚于结束时间" });
  });

  it("是否有筛选", () => {
    expect(hasAuditFilters(NONE)).toBe(false);
    expect(hasAuditFilters({ ...NONE, actor: "1" })).toBe(true);
  });
});

describe("详情 JSON 展示", () => {
  it("内嵌的 JSON 文本（如更新前的 config）展开成对象，其余原样", () => {
    const detail = { before: { name: "x", config: '{"a":[1,{"b":"[2]"}]}' }, note: "{不是 JSON", n: 3, list: ['{"k":1}', "plain"] };
    expect(expandJsonStrings(detail)).toEqual({ before: { name: "x", config: { a: [1, { b: [2] }] } }, note: "{不是 JSON", n: 3, list: [{ k: 1 }, "plain"] });
    expect(expandJsonStrings(null)).toBeNull();
  });
});

describe("文案", () => {
  it("已知动作与目标翻成中文，未知的原样显示", () => {
    expect(actionLabel("rule_group.update")).toBe("修改规则组");
    expect(actionLabel("future.action")).toBe("future.action");
    expect(targetLabel("rule_group", "7")).toBe("规则组 #7");
    expect(targetLabel("mailbox", null)).toBe("收件地址");
    expect(targetLabel("weird", "1")).toBe("weird #1");
    expect(targetLabel(null, null)).toBeNull();
  });
});
