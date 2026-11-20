import type { ConditionHit, RuleGroupTestItem } from "@maillink/shared";
import { FIELD_LABEL, OP_LABEL } from "../labels";

// 测试器的原因码 → 中文说明与色调（DESIGN「测试器」：deny 红、解析 / 截断赭、其余灰）

export type ReasonTone = "danger" | "warning" | "neutral";

const REASON_TEXT: Record<string, string> = {
  allow_match: "命中允许规则",
  blacklist_pass: "黑名单模式：没有被任何屏蔽规则命中",
  deny: "命中屏蔽规则",
  no_allow_match: "没有命中任何启用的允许规则",
  out_of_window: "超出时间范围（滚动窗口或起始锚点之前）",
  parse_failed: "邮件解析失败：访客看不到；管理员可在“全部邮件”里看原文",
  body_truncated: "正文超长，无法完整判定（规则里有正文类屏蔽或脱敏），按失败关闭不显示",
  no_code: "没有提取到验证码 / 登录链接，“仅验证码”视图不显示这类邮件",
  max_mails: "被“最多显示 N 封”截掉：只保留最新的几封",
  pending: "这次还没轮到解析，稍后会补上（点“重新试跑”）",
};

const TONES: Record<string, ReasonTone> = {
  deny: "danger",
  parse_failed: "warning",
  body_truncated: "warning",
  pending: "warning",
};

export type ReasonView = { code: string; tag: string; text: string; tone: ReasonTone };

/** 原因码未登记时原样显示（不吞）：后端新增原因码时界面仍能看到它 */
export function describeReason(item: Pick<RuleGroupTestItem, "reason_code" | "reason">): ReasonView {
  return {
    code: item.reason_code,
    tag: item.reason,
    text: REASON_TEXT[item.reason_code] ?? `未登记的原因码 ${item.reason_code}`,
    tone: TONES[item.reason_code] ?? "neutral",
  };
}

export function describeHit(hit: ConditionHit): string {
  if (hit.kind === "not") return `not 条件成立（${hit.path}）`;
  const base = hit.op === "is" ? `${FIELD_LABEL[hit.field]}：${hit.value === "false" ? "否" : "是"}` : `${FIELD_LABEL[hit.field]} ${OP_LABEL[hit.op]} ${hit.value}`;
  return hit.candidate !== undefined ? `${base}（命中：${hit.candidate}）` : base;
}

export const CODE_ORIGIN_LABEL = {
  ai_extract: "temp_email 的 AI 提取",
  code_regex: "规则组的自定义正则",
  builtin: "内置提取",
} as const;
