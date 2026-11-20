import { z } from "zod";
import { EMAIL_MAX_LENGTH } from "./limits";
import { MAX_UNIX_SECONDS } from "./mails";
import { VIEW_MODES, ruleSchema } from "./rule-group";
import { presentedMailSchema } from "./rule-group-presented-mail";
import { extractedValuesSchema, matchedRuleSchema } from "./rule-group-trace";
import type { RuleGroupIssue } from "./rule-group-issues";

// 管理端"规则组"的请求与响应，见 docs/design/04-api.md 管理端 / 规则组。
// config 在边界只要求是 JSON 对象，形状与语义由 validateRuleGroupConfig 校验（错误带 issues 路径返回给编辑器）。

export const RULE_GROUP_API_LIMITS = {
  nameMaxLength: 64,
  descriptionMaxLength: 500,
  /** 测试器一次最多的收件地址数 / 邮件 id 数 */
  testMaxTargets: 50,
  /** 测试器按收件地址取最近几封 */
  testDefaultMails: 20,
  testMaxMails: 100,
  /** 用量接口每类最多列出的引用方 */
  usageListMax: 100,
} as const;

const nameSchema = z.string().trim().min(1).max(RULE_GROUP_API_LIMITS.nameMaxLength);
const descriptionSchema = z.string().trim().max(RULE_GROUP_API_LIMITS.descriptionMaxLength).nullable();
const configSchema = z.record(z.string(), z.unknown());

export const ruleGroupCreateSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  config: configSchema,
});
export type RuleGroupCreate = z.input<typeof ruleGroupCreateSchema>;

export const ruleGroupUpdateSchema = ruleGroupCreateSchema.extend({
  /** 读取时拿到的 revision；与库里不一致返回 409 revision_conflict */
  revision: z.number().int().positive(),
});
export type RuleGroupUpdate = z.input<typeof ruleGroupUpdateSchema>;

/** 结构与 RuleGroupIssue 一致（类型在 rule-group-issues.ts），这里只做响应形状声明 */
const issueSchema = z.custom<RuleGroupIssue>();

export const adminRuleGroupSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  schema_version: z.number().int(),
  revision: z.number().int(),
  /** 配置能否编译；无效时引用它的链接与授权全部不可见（02 §5 失败关闭），列表标红 */
  invalid: z.boolean(),
  invalid_code: z.string().nullable(),
  view: z.enum(VIEW_MODES).nullable(),
  link_count: z.number().int(),
  grant_count: z.number().int(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export type AdminRuleGroupSummary = z.infer<typeof adminRuleGroupSummarySchema>;

export const adminRuleGroupListSchema = z.object({
  items: z.array(adminRuleGroupSummarySchema),
  next_cursor: z.string().nullable(),
});
export type AdminRuleGroupList = z.infer<typeof adminRuleGroupListSchema>;

export const adminRuleGroupDetailSchema = adminRuleGroupSummarySchema.extend({
  /** 库里存的原样配置 */
  config: z.unknown(),
  /** 配置无效时的错误（编译用的校验，不试跑计时） */
  issues: z.array(issueSchema),
});
export type AdminRuleGroupDetail = z.infer<typeof adminRuleGroupDetailSchema>;

export const ruleGroupSaveResponseSchema = z.object({
  rule_group: adminRuleGroupDetailSchema,
  /** 保存校验的警告（不阻止保存） */
  warnings: z.array(issueSchema),
});
export type RuleGroupSaveResponse = z.infer<typeof ruleGroupSaveResponseSchema>;

export const ruleGroupUsageSchema = z.object({
  link_count: z.number().int(),
  grant_count: z.number().int(),
  links: z.array(z.object({ id: z.number().int(), name: z.string().nullable(), status: z.string() })),
  grants: z.array(
    z.object({
      id: z.number().int(),
      user_id: z.number().int(),
      username: z.string(),
      mailbox_id: z.number().int(),
      address: z.string(),
    }),
  ),
});
export type RuleGroupUsage = z.infer<typeof ruleGroupUsageSchema>;

const unixSeconds = z.number().int().nonnegative().max(MAX_UNIX_SECONDS);

export const ruleGroupTestRequestSchema = z
  .object({
    /** 未保存的配置 */
    config: configSchema,
    /** 按收件地址取最近的邮件 */
    addresses: z.array(z.string().trim().min(1).max(EMAIL_MAX_LENGTH)).min(1).max(RULE_GROUP_API_LIMITS.testMaxTargets).optional(),
    /** 或者直接给邮件 id */
    mail_ids: z.array(z.number().int().positive()).min(1).max(RULE_GROUP_API_LIMITS.testMaxTargets).optional(),
    /** 模拟链接 / 授权的创建与首次访问时间（Unix 秒），默认当前时间 */
    anchor_at: unixSeconds.optional(),
    limit: z.number().int().min(1).max(RULE_GROUP_API_LIMITS.testMaxMails).optional(),
  })
  .refine((body) => (body.addresses === undefined) !== (body.mail_ids === undefined), {
    message: "addresses 与 mail_ids 必须且只能给一个",
  });
export type RuleGroupTestRequest = z.input<typeof ruleGroupTestRequestSchema>;

/** 测试器在求值原因之外的两种结果：被 max_mails 截掉；本次没轮到解析 */
export const RULE_TEST_EXTRA_REASONS = ["max_mails", "pending"] as const;

export const ruleGroupTestItemSchema = z.object({
  mail_id: z.number().int(),
  received_at: z.number().int(),
  recipient: z.string(),
  parse_status: z.enum(["ok", "failed", "pending"]),
  /**
   * 管理员视角的发件人与主题，不受规则组呈现设置影响、不可见的邮件也给（测试器只有管理员能用）；
   * 只有解析成功（parse_status = ok）时才有，failed / pending 为 null
   */
  sender: z.object({ address: z.string().nullable(), name: z.string().nullable() }).nullable(),
  subject: z.string().nullable(),
  visible: z.boolean(),
  /** reason_code 之外再加 max_mails / pending */
  reason_code: z.string(),
  /** `deny:<规则名>` 等展示用原因 */
  reason: z.string(),
  matched: z.array(matchedRuleSchema),
  extracted: extractedValuesSchema.nullable(),
  /** 访问者视角的列表项；不可见时为 null */
  preview: presentedMailSchema.nullable(),
});
export type RuleGroupTestItem = z.infer<typeof ruleGroupTestItemSchema>;

export const ruleGroupTestResponseSchema = z.object({
  items: z.array(ruleGroupTestItemSchema),
  /** 有邮件本次没解析到，稍后重试 */
  partial: z.boolean(),
  time_lower_bound: z.number().int().nullable(),
  /** 编译用校验之外的保存校验警告（同编辑器） */
  warnings: z.array(issueSchema),
});
export type RuleGroupTestResponse = z.infer<typeof ruleGroupTestResponseSchema>;

export const ruleGroupDraftRequestSchema = z.object({ mail_id: z.number().int().positive() });
export type RuleGroupDraftRequest = z.infer<typeof ruleGroupDraftRequestSchema>;

/** POST /api/admin/rule-groups/draft-from-mail 的响应：一条 allow 规则草稿与建议的验证码正则 */
export const ruleGroupDraftResponseSchema = z.strictObject({
  /** 既没有可用的发件人域名也没有主题时为 null */
  rule: ruleSchema.nullable(),
  /** 草稿里主题条件用的正则（`^…$` 整句匹配） */
  subject_pattern: z.string().nullable(),
  /** 建议填到 present.code_regex 的正则 */
  code_regex: z.string().nullable(),
  /** 给管理员看的说明：泛化了什么、哪里需要人工确认 */
  notes: z.array(z.string()),
});
export type RuleGroupDraftResponse = z.infer<typeof ruleGroupDraftResponseSchema>;
