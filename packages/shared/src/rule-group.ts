import { z } from "zod";
import { RULE_GROUP_LIMITS, RULE_GROUP_SCHEMA_VERSION } from "./rule-group-limits";

// 规则组配置 schema，见 docs/design/02-rule-engine.md §2–§4。
// 这里只做结构校验（形状、类型、未知字段）；字段与操作符是否匹配、上限、互斥约束等语义校验在 rule-group-validate.ts。
// 对象一律 strict：拼错的字段直接报错，不静默忽略（失败关闭）。

/** 内置邮件分类（02 §3.6），判定顺序即数组顺序 */
export const MAIL_CATEGORIES = [
  "email_change",
  "password_reset",
  "security_change",
  "billing",
  "verification",
  "other",
] as const;
export const mailCategorySchema = z.enum(MAIL_CATEGORIES);
export type MailCategory = z.infer<typeof mailCategorySchema>;

/** 条件可用字段（02 §3.3） */
export const RULE_FIELDS = [
  "sender.address",
  "sender.domain",
  "sender.name",
  "sender.envelope",
  "recipient",
  "subject",
  "body",
  "content",
  "link.domains",
  "code.present",
  "login_link.present",
  "category",
  "has_attachment",
  "attachment.name",
  "size",
] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

/** 操作符（02 §3.4） */
export const RULE_OPS = ["eq", "contains", "starts_with", "ends_with", "domain_is", "regex", "is", "gt", "lt"] as const;
export type RuleOp = (typeof RULE_OPS)[number];

/** 字段类型 */
export type RuleFieldKind = "text" | "text_list" | "domain_list" | "bool" | "enum" | "number";

export const RULE_FIELD_KINDS: Readonly<Record<RuleField, RuleFieldKind>> = {
  "sender.address": "text_list",
  "sender.domain": "domain_list",
  "sender.name": "text",
  "sender.envelope": "text",
  recipient: "text",
  subject: "text",
  body: "text",
  content: "text",
  "link.domains": "domain_list",
  "code.present": "bool",
  "login_link.present": "bool",
  category: "enum",
  has_attachment: "bool",
  "attachment.name": "text_list",
  size: "number",
};

/** 文本类操作符：value 可以是字符串或字符串数组（数组 = 其中任一），默认不区分大小写 */
export const TEXT_OPS = ["eq", "contains", "starts_with", "ends_with", "regex"] as const satisfies readonly RuleOp[];
export type TextOp = (typeof TEXT_OPS)[number];

/** 每种字段类型可用的操作符 */
export const RULE_OPS_BY_KIND: Readonly<Record<RuleFieldKind, readonly RuleOp[]>> = {
  text: TEXT_OPS,
  text_list: TEXT_OPS,
  domain_list: ["domain_is", ...TEXT_OPS],
  bool: ["is"],
  enum: ["eq"],
  number: ["gt", "lt"],
};

/** 依赖完整正文的字段（02 §3.5） */
export const BODY_FIELDS: readonly RuleField[] = ["body", "content"];

const text = (max: number) => z.string().max(max);

export const condValueSchema = z.union([
  text(RULE_GROUP_LIMITS.maxTextValueLength),
  z.array(text(RULE_GROUP_LIMITS.maxTextValueLength)),
  z.number(),
  z.boolean(),
]);
export type CondValue = z.infer<typeof condValueSchema>;

export type CondLeaf = {
  field: RuleField;
  op: RuleOp;
  value: CondValue;
  case_sensitive?: boolean;
};
export type Cond = { all: Cond[] } | { any: Cond[] } | { not: Cond } | CondLeaf;

export const condLeafSchema = z.strictObject({
  field: z.enum(RULE_FIELDS),
  op: z.enum(RULE_OPS),
  value: condValueSchema,
  case_sensitive: z.boolean().optional(),
});

/** union 分支顺序，错误映射时据输入的键挑选分支（见 rule-group-validate-zod.ts） */
export const COND_BRANCH_KEYS = ["all", "any", "not", "field"] as const;

export const condSchema: z.ZodType<Cond> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(condSchema) }),
    z.strictObject({ any: z.array(condSchema) }),
    z.strictObject({ not: condSchema }),
    condLeafSchema,
  ]),
);

export const ruleSchema = z.strictObject({
  id: z.string().min(1).max(RULE_GROUP_LIMITS.maxIdLength),
  name: z.string().min(1).max(RULE_GROUP_LIMITS.maxNameLength),
  enabled: z.boolean(),
  effect: z.enum(["allow", "deny"]),
  when: condSchema,
});
export type Rule = z.infer<typeof ruleSchema>;

export const redactionSchema = z.strictObject({
  name: z.string().min(1).max(RULE_GROUP_LIMITS.maxNameLength),
  match: z.strictObject({
    type: z.enum(["text", "regex"]),
    pattern: text(RULE_GROUP_LIMITS.maxTextValueLength),
  }),
  scope: z.array(z.enum(["subject", "body"])).min(1),
  replace: text(RULE_GROUP_LIMITS.maxReplaceLength),
});
export type Redaction = z.infer<typeof redactionSchema>;

const minutes = (min: number) => z.number().int().min(min).max(RULE_GROUP_LIMITS.maxMinutes);

export const timeConfigSchema = z.strictObject({
  window_minutes: minutes(1).optional(),
  since: z.strictObject({
    type: z.enum(["none", "subject_created", "first_access", "fixed"]),
    at: z.number().int().min(0).optional(),
    lookback_minutes: minutes(0).optional(),
  }),
});
export type TimeConfig = z.infer<typeof timeConfigSchema>;

export const linksConfigSchema = z.union([
  z.literal("keep"),
  z.literal("strip"),
  z.strictObject({ allow_domains: z.array(text(RULE_GROUP_LIMITS.maxTextValueLength)) }),
]);
export type LinksConfig = z.infer<typeof linksConfigSchema>;

export const VIEW_MODES = ["full", "text", "code_only", "meta_only"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const EXTRACT_TARGETS = ["code", "login_link"] as const;
export type ExtractTarget = (typeof EXTRACT_TARGETS)[number];

export const presentConfigSchema = z.strictObject({
  view: z.enum(VIEW_MODES),
  sender: z.enum(["full", "domain", "name", "hidden"]),
  recipient: z.enum(["full", "masked", "hidden"]),
  snippet: z.boolean(),
  links: linksConfigSchema,
  remote_images: z.enum(["block", "allow"]),
  attachments: z.enum(["hidden", "list", "download"]),
  redact: z.array(redactionSchema),
  /** code_only 视图显示什么，默认 ['code']（02 §2） */
  extract: z.array(z.enum(EXTRACT_TARGETS)).default(["code"]),
  code_regex: text(RULE_GROUP_LIMITS.maxTextValueLength).optional(),
});
export type PresentConfig = z.infer<typeof presentConfigSchema>;

export const ruleGroupConfigSchema = z.strictObject({
  schema_version: z.literal(RULE_GROUP_SCHEMA_VERSION),
  time: timeConfigSchema,
  filter: z.strictObject({
    mode: z.enum(["whitelist", "blacklist"]),
    rules: z.array(ruleSchema),
  }),
  present: presentConfigSchema,
  limits: z.strictObject({
    max_mails: z.number().int().min(1).max(RULE_GROUP_LIMITS.maxMailsCap).optional(),
  }),
});
/** 校验通过后的配置（extract 已补默认值） */
export type RuleGroupConfig = z.output<typeof ruleGroupConfigSchema>;
/** 编辑器 / 接口提交的配置形状（extract 可省略） */
export type RuleGroupConfigInput = z.input<typeof ruleGroupConfigSchema>;
