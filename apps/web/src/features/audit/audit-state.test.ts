import { describe, expect, it } from "vitest";
import { expandJsonStrings, hasAuditFilters, toAuditQuery } from "./audit-state";
import { actionLabel, reasonLabel, targetLabel } from "./labels";
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
    expect(actionLabel("auth.identity_link_start")).toBe("发起关联外部身份");
    expect(actionLabel("auth.identity_link_rejected")).toBe("拒绝关联外部身份");
    expect(targetLabel("rule_group", "7")).toBe("规则组 #7");
    expect(targetLabel("mailbox", null)).toBe("收件地址");
    expect(targetLabel("weird", "1")).toBe("weird #1");
    expect(targetLabel(null, null)).toBeNull();
  });
});

describe("拒绝原因文案", () => {
  it("关联外部身份被拒的原因翻成中文；未知原因原样；没有 reason 或不是字符串返回 null", () => {
    expect(reasonLabel({ provider: "github", reason: "session_mismatch" })).toBe("回调时已不是发起绑定的那个登录会话");
    expect(reasonLabel({ reason: "bound_to_other_user" })).toBe("该外部身份已绑定其他用户");
    expect(reasonLabel({ reason: "token_invalid" })).toBe("提供方返回的令牌校验失败");
    expect(reasonLabel({ reason: "future_reason" })).toBe("future_reason");
    expect(reasonLabel({ provider: "github" })).toBeNull();
    expect(reasonLabel({ reason: 3 })).toBeNull();
    expect(reasonLabel(null)).toBeNull();
  });
});
