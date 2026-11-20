import type { RuleGroupConfigInput } from "./rule-group";
import { RULE_GROUP_SCHEMA_VERSION } from "./rule-group-limits";

// 内置规则组模板：02 §9 的三个 + 06 §3 的模板 A / B / C。初始化时写入为普通规则组，可改可删。
// 06 的模板用 openai.com 作示例平台（与文档一致），使用前改成目标平台的域名。

export type RuleGroupTemplate = {
  key: string;
  name: string;
  description: string;
  config: RuleGroupConfigInput;
};

const HIGH_RISK_KEYWORDS = [
  "重设密码",
  "重置密码",
  "修改密码",
  "找回密码",
  "reset your password",
  "password reset",
  "パスワードの再設定",
];

/**
 * 模板 B 屏蔽付款方式变更通知用的关键词（content 包含即屏蔽，不区分大小写）。
 * 付款方式变更的验证码邮件内置分类是 security_change，不是 billing，"屏蔽账单"那条拦不住。
 */
const PAYMENT_METHOD_KEYWORDS = [
  "payment method",
  "payment details",
  "payment information",
  "billing information",
  "billing details",
  "card ending",
  "付款方式",
  "支付方式",
  "付款信息",
  "支付信息",
  "お支払い方法",
];

const resaleShared = (): RuleGroupConfigInput => ({
  schema_version: RULE_GROUP_SCHEMA_VERSION,
  time: { window_minutes: 15, since: { type: "first_access", lookback_minutes: 5 } },
  filter: {
    mode: "whitelist",
    rules: [
      {
        id: "allow-login",
        name: "本平台的验证码",
        enabled: true,
        effect: "allow",
        when: {
          all: [
            { field: "sender.domain", op: "domain_is", value: ["openai.com"] },
            { field: "category", op: "eq", value: "verification" },
          ],
        },
      },
      {
        id: "deny-custom",
        name: "自定义屏蔽词",
        enabled: true,
        effect: "deny",
        when: { field: "content", op: "contains", value: ["更换邮箱", "change your email"] },
      },
    ],
  },
  present: {
    view: "code_only",
    extract: ["code"],
    sender: "name",
    recipient: "full",
    snippet: false,
    links: "strip",
    remote_images: "block",
    attachments: "hidden",
    redact: [],
  },
  limits: { max_mails: 3 },
});

/** 完整显示的呈现配置（"完整访问"与"指定发件人（完整显示）"共用） */
const fullPresent = (): RuleGroupConfigInput["present"] => ({
  view: "full",
  sender: "full",
  recipient: "full",
  snippet: true,
  links: "keep",
  remote_images: "block",
  attachments: "download",
  redact: [],
  extract: ["code"],
});

const TEMPLATES: readonly RuleGroupTemplate[] = [
  {
    key: "code_only",
    name: "仅验证码",
    description:
      "10 分钟窗口、从链接创建时算起；只显示验证码；收件地址打码；屏蔽改密等高危邮件；最多 5 封。（在 02 §9 示例基础上补了一条按内置分类屏蔽高危邮件的规则）",
    config: {
      schema_version: RULE_GROUP_SCHEMA_VERSION,
      time: { window_minutes: 10, since: { type: "subject_created", lookback_minutes: 0 } },
      filter: {
        mode: "whitelist",
        rules: [
          { id: "r1", name: "含验证码", enabled: true, effect: "allow", when: { field: "code.present", op: "is", value: true } },
          {
            id: "r2",
            name: "屏蔽改密与安全通知",
            enabled: true,
            effect: "deny",
            when: { field: "content", op: "contains", value: HIGH_RISK_KEYWORDS },
          },
          {
            id: "r3",
            name: "屏蔽高危分类",
            enabled: true,
            effect: "deny",
            when: { field: "category", op: "eq", value: ["password_reset", "email_change", "security_change"] },
          },
        ],
      },
      present: {
        view: "code_only",
        sender: "domain",
        recipient: "masked",
        snippet: false,
        links: "strip",
        remote_images: "block",
        attachments: "hidden",
        redact: [],
        extract: ["code"],
      },
      limits: { max_mails: 5 },
    },
  },
  {
    key: "sender_whitelist",
    name: "指定发件人",
    description: "白名单模式。把规则里的示例域名改成要放行的发件人域名并启用后才会显示邮件；纯文本视图，隐藏链接。",
    config: {
      schema_version: RULE_GROUP_SCHEMA_VERSION,
      time: { since: { type: "subject_created", lookback_minutes: 0 } },
      filter: {
        mode: "whitelist",
        rules: [
          {
            id: "allow-sender",
            name: "允许的发件人（填写域名后启用）",
            enabled: false,
            effect: "allow",
            when: { field: "sender.domain", op: "domain_is", value: ["example.com"] },
          },
        ],
      },
      present: {
        view: "text",
        sender: "full",
        recipient: "masked",
        snippet: true,
        links: "strip",
        remote_images: "block",
        attachments: "list",
        redact: [],
        extract: ["code"],
      },
      limits: {},
    },
  },
  {
    key: "full_access",
    name: "完整访问",
    description: "黑名单模式、无规则、完整 HTML 视图（远程图片默认阻止）。",
    config: {
      schema_version: RULE_GROUP_SCHEMA_VERSION,
      time: { since: { type: "none" } },
      filter: { mode: "blacklist", rules: [] },
      present: fullPresent(),
      limits: {},
    },
  },
  {
    key: "resale_shared",
    name: "卖号：共享 / 租号（模板 A）",
    description: "只给本平台登录验证码（L2：发件人域名 + 内置分类为 verification），从买家点击开始取码时算起。",
    config: resaleShared(),
  },
  {
    key: "resale_buyout",
    name: "卖号：买断（模板 B）",
    description:
      "质保期内收本平台的邮件（L1：只限发件人域名），屏蔽账单与付款方式变更通知；纯文本视图、保留链接（买家要点确认链接换绑邮箱）。",
    config: {
      schema_version: RULE_GROUP_SCHEMA_VERSION,
      time: { since: { type: "first_access", lookback_minutes: 10 } },
      filter: {
        mode: "whitelist",
        rules: [
          {
            id: "allow-platform",
            name: "本平台发件人",
            enabled: true,
            effect: "allow",
            when: { field: "sender.domain", op: "domain_is", value: ["openai.com"] },
          },
          { id: "deny-billing", name: "屏蔽账单", enabled: true, effect: "deny", when: { field: "category", op: "eq", value: "billing" } },
          {
            id: "deny-payment-method",
            name: "屏蔽付款方式通知",
            enabled: true,
            effect: "deny",
            when: { field: "content", op: "contains", value: PAYMENT_METHOD_KEYWORDS },
          },
        ],
      },
      present: {
        view: "text",
        extract: ["code"],
        sender: "name",
        recipient: "full",
        snippet: true,
        links: "keep",
        remote_images: "block",
        attachments: "hidden",
        redact: [],
      },
      limits: {},
    },
  },
  {
    key: "resale_login_link",
    name: "卖号：发登录链接的平台（模板 C）",
    description: "在模板 A 基础上同时提取登录链接（只取本平台域名的链接）。登录链接等同一次完整登录，只给确实不发验证码的平台用。",
    config: {
      ...resaleShared(),
      present: { ...resaleShared().present, extract: ["code", "login_link"], links: { allow_domains: ["openai.com"] } },
    },
  },
  {
    key: "sender_full",
    name: "指定发件人（完整显示）",
    description:
      "白名单模式，只放行 openai.com、chatgpt.com（含子域名）的邮件，从链接创建时开始；放行的邮件完整显示（HTML 正文、保留链接、附件可下载、收件地址不打码，远程图片默认阻止）。需要其他平台时在编辑器里改域名。",
    config: {
      schema_version: RULE_GROUP_SCHEMA_VERSION,
      time: { since: { type: "subject_created", lookback_minutes: 0 } },
      filter: {
        mode: "whitelist",
        rules: [
          {
            id: "allow-sender",
            name: "允许的发件人",
            enabled: true,
            effect: "allow",
            when: { field: "sender.domain", op: "domain_is", value: ["openai.com", "chatgpt.com"] },
          },
        ],
      },
      present: fullPresent(),
      limits: {},
    },
  },
];

/** 内置模板（每次返回新的深拷贝，调用方可随意修改） */
export function builtinRuleGroupTemplates(): RuleGroupTemplate[] {
  return JSON.parse(JSON.stringify(TEMPLATES)) as RuleGroupTemplate[];
}
