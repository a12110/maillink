import { MAIL_CATEGORIES } from "@maillink/shared";
import type { CondLeaf, MailCategory, RuleField, RuleOp, ViewMode } from "@maillink/shared";

export const FIELD_LABEL: Record<RuleField, string> = {
  "sender.address": "发件人地址",
  "sender.domain": "发件人域名",
  "sender.name": "发件人名称",
  "sender.envelope": "信封发件人",
  recipient: "收件地址",
  subject: "主题",
  body: "正文",
  content: "主题 + 正文",
  "link.domains": "正文链接的域名",
  "code.present": "提取到验证码",
  "login_link.present": "提取到登录链接",
  category: "邮件分类",
  has_attachment: "有附件",
  "attachment.name": "附件名",
  size: "邮件大小（字节）",
};

/** 字段下拉的顺序：发件人 → 内容 → 派生信息 */
export const FIELD_ORDER: readonly RuleField[] = [
  "sender.domain",
  "sender.address",
  "sender.name",
  "sender.envelope",
  "recipient",
  "subject",
  "body",
  "content",
  "category",
  "code.present",
  "login_link.present",
  "link.domains",
  "has_attachment",
  "attachment.name",
  "size",
];

export const OP_LABEL: Record<RuleOp, string> = {
  eq: "等于",
  contains: "包含",
  starts_with: "开头是",
  ends_with: "结尾是",
  domain_is: "是该域名或子域名",
  regex: "匹配正则",
  is: "是",
  gt: "大于",
  lt: "小于",
};

export const CATEGORY_NAME: Record<MailCategory, string> = {
  email_change: "更换邮箱",
  password_reset: "重设密码",
  security_change: "安全变更",
  billing: "账单",
  verification: "登录验证码",
  other: "其他",
};

export const CATEGORY_OPTIONS = MAIL_CATEGORIES;

export const VIEW_LABEL: Record<ViewMode, string> = { full: "完整", text: "纯文本", code_only: "仅验证码", meta_only: "仅元信息" };

/** 一个叶子条件的一句话描述：`主题 + 正文 包含 更换邮箱、change your email` */
export function describeLeaf(leaf: CondLeaf): string {
  const field = FIELD_LABEL[leaf.field] ?? leaf.field;
  if (leaf.op === "is") return `${field}：${leaf.value === false ? "否" : "是"}`;
  const op = OP_LABEL[leaf.op] ?? leaf.op;
  const value = Array.isArray(leaf.value) ? leaf.value.join("、") : String(leaf.value);
  return `${field} ${op} ${value}`;
}
