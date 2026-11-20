// 邮件库（temp_email）兼容提示文案。口径与 worker 的 WARNING_NO_TO_ADDRESS 一致（两边测试各自断言关键词）。

export const NO_ICLOUD_TITLE = "不支持 iCloud 隐私邮箱（Hide My Email）";

/** 迁移文件名与起始版本：与 docs/deploy.md §2.2 一致 */
export const TO_ADDRESS_MIGRATION = "db/2026-08-02-to-address.sql";
export const TO_ADDRESS_MIN_VERSION = "v1.15.0";

export const NO_ICLOUD_BODY =
  "当前 cloudflare_temp_email 数据库不是适配 MailLink 的修改版（raw_mails 缺少 to_address 列）：" +
  "以 iCloud 别名作为收件地址时收不到邮件，其他收件地址不受影响。" +
  `要使用 iCloud 隐私邮箱，请把 temp_email 升级到包含 ${TO_ADDRESS_MIGRATION} 迁移的修改版（${TO_ADDRESS_MIN_VERSION} 起）并执行该迁移`;

export const NO_ICLOUD_SETUP_SUFFIX = "，之后刷新本页确认。";
export const NO_ICLOUD_ADMIN_SUFFIX = "。";

/** 导入内容里含这些域名的地址时，在提示后补一句强调 */
export const ICLOUD_ALIAS_DOMAINS = ["icloud.com", "privaterelay.appleid.com"] as const;
export const NO_ICLOUD_IMPORT_EMPHASIS = "你粘贴的内容里含 iCloud 隐私邮箱地址，导入后这些地址将收不到邮件。";

export const UNHEALTHY_TITLE = "邮件库（MAIL_DB）不可用";
export const PROBE_FAILED_TITLE = "无法探测邮件库（MAIL_DB）";

export function hasIcloudAlias(content: string): boolean {
  const lower = content.toLowerCase();
  return ICLOUD_ALIAS_DOMAINS.some((domain) => lower.includes(`@${domain}`));
}
