import { z } from "zod";
import { RULE_FIELDS, RULE_OPS } from "./rule-group";

// 规则求值结果与 trace（02 §8 规则测试器、管理员预览共用，没有第二套逻辑）。

/**
 * 原因码。不可见：deny / no_allow_match / out_of_window / parse_failed / body_truncated / no_code；
 * 可见：allow_match（白名单命中）/ blacklist_pass（黑名单且未被屏蔽）。
 */
export const EVALUATION_REASON_CODES = [
  "allow_match",
  "blacklist_pass",
  "deny",
  "no_allow_match",
  "out_of_window",
  "parse_failed",
  "body_truncated",
  "no_code",
] as const;
export const evaluationReasonCodeSchema = z.enum(EVALUATION_REASON_CODES);
export type EvaluationReasonCode = z.infer<typeof evaluationReasonCodeSchema>;

/** 命中的叶子条件；或一个因子条件为假而成立的 not 节点 */
export const conditionHitSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("leaf"),
    /** 条件在规则里的位置，如 `when.all[1]` */
    path: z.string(),
    field: z.enum(RULE_FIELDS),
    op: z.enum(RULE_OPS),
    /** 命中的那个规则取值（数组取值时是其中命中的一项） */
    value: z.string(),
    /** 列表字段命中的元素（如命中的发件人域名）；正文类字段不回显内容 */
    candidate: z.string().optional(),
  }),
  z.object({ kind: z.literal("not"), path: z.string() }),
]);
export type ConditionHit = z.infer<typeof conditionHitSchema>;

export const matchedRuleSchema = z.object({
  rule_id: z.string(),
  rule_name: z.string(),
  effect: z.enum(["allow", "deny"]),
  hits: z.array(conditionHitSchema),
});
export type MatchedRule = z.infer<typeof matchedRuleSchema>;

/** 验证码提取的每一步（02 §4.6 的严格优先级），测试器据此显示"为什么是这个码" */
export const codeStepSchema = z.object({
  step: z.enum(["ai_extract", "code_regex", "builtin"]),
  result: z.enum(["used", "skipped", "no_match", "invalid", "not_applicable"]),
});
export type CodeStep = z.infer<typeof codeStepSchema>;

export const extractedValuesSchema = z.object({
  code: z.string().nullable(),
  code_origin: z.enum(["ai_extract", "code_regex", "builtin"]).nullable(),
  code_steps: z.array(codeStepSchema),
  login_link: z.string().nullable(),
});
export type ExtractedValues = z.infer<typeof extractedValuesSchema>;

export const ruleEvaluationSchema = z.object({
  mail_id: z.number().int(),
  received_at: z.number().int(),
  visible: z.boolean(),
  reason_code: evaluationReasonCodeSchema,
  /** 展示用原因：`deny:<规则名>`、`allow:<规则名>`，其余等于 reason_code */
  reason: z.string(),
  /** 决定结果的那条规则（deny / allow_match 时） */
  reason_rule: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** 所有命中的启用规则，按配置顺序 */
  matched: z.array(matchedRuleSchema),
  /** 解析失败、超出时间范围时为 null（未做提取） */
  extracted: extractedValuesSchema.nullable(),
});
export type RuleEvaluation = z.infer<typeof ruleEvaluationSchema>;
