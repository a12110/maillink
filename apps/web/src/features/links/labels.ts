import type { AdminShareLink, LinkLog, ShareLinkAnomaly, ShareLinkState } from "@maillink/shared";

export const STATE_LABEL: Record<ShareLinkState, string> = {
  active: "生效中",
  pending: "未到生效时间",
  expired: "已过期",
  exhausted: "次数用尽",
  paused: "已暂停",
  revoked: "已撤销",
};

/** 一行最多一个彩色状态：正常绿，需留意赭，其余灰 */
export const STATE_TONE: Record<ShareLinkState, "success" | "neutral" | "warning"> = {
  active: "success",
  pending: "neutral",
  expired: "warning",
  exhausted: "warning",
  paused: "neutral",
  revoked: "neutral",
};

export const ANOMALY_LABEL: Record<ShareLinkAnomaly, string> = {
  device_limit_reached: "设备数已满",
  multi_country: "多国访问",
};

/** 表格行里的短标签（侧板里写全称与说明） */
export const ANOMALY_SHORT: Record<ShareLinkAnomaly, string> = {
  device_limit_reached: "设备满",
  multi_country: "多国",
};

export const ANOMALY_HINT: Record<ShareLinkAnomaly, string> = {
  device_limit_reached: "已登记的设备数达到上限，新设备会看到“设备已满”。换了手机的买家需要重置设备。",
  multi_country: "这个链接被来自多个国家的访客打开过，可能已被转发。",
};

export const EVENT_LABEL: Record<LinkLog["event"], string> = {
  start: "开始取码",
  deliver: "取码",
  download: "下载附件",
  denied: "被拒绝",
  api_code: "API 取码",
};

/** 访问日志里的被拒原因（对访问者统一显示“已失效”，这里给管理员看具体原因） */
const REASON_LABEL: Record<string, string> = {
  revoked: "已撤销",
  paused: "已暂停",
  expired: "已过期",
  expired_after_first_access: "首次取码后有效期已到",
  not_yet_valid: "未到生效时间",
  ip_denied: "来源 IP 不在白名单",
  country_denied: "来源国家不在白名单",
  total_limit: "总取码次数已用尽",
  device_limit: "设备数已满",
  daily_limit: "每日取码次数已用尽",
  bad_password: "口令错误",
  password_locked: "口令错误过多，已锁定",
  password_required: "未输入口令",
  no_mailbox: "没有可用的收件地址",
  start_required: "未开始取码",
  turnstile_failed: "人机验证未通过",
  turnstile_unavailable: "人机验证不可用",
  // API 取码（api_code 事件）的结果与专有原因
  ok: "取到验证码",
  no_code: "暂无验证码",
  pending: "邮件处理中",
  view_meta_only: "仅元信息视图，不返回验证码",
  api_disabled: "未允许 API 取码",
  turnstile_required: "需要人机验证（API 不可用）",
};

export function describeReason(reason: string | null): string {
  if (reason === null) return "";
  if (reason.startsWith("attachment:")) return `附件 #${reason.slice("attachment:".length)}`;
  return REASON_LABEL[reason] ?? reason;
}

/** 名称 → 订单号 → token 前缀，总有一个能认出这条链接 */
export function linkTitle(link: Pick<AdminShareLink, "name" | "order_ref" | "token_hint">): string {
  return link.name ?? link.order_ref ?? `链接 ${link.token_hint}…`;
}

export function addressSummary(link: Pick<AdminShareLink, "mailboxes">): { first: string | null; more: number } {
  return { first: link.mailboxes[0]?.address ?? null, more: Math.max(0, link.mailboxes.length - 1) };
}

/** 设备数列：已登记 / 上限（无上限只写已登记） */
export function devicesText(link: Pick<AdminShareLink, "device_count" | "access">): string {
  const max = link.access.max_devices;
  return max === undefined ? String(link.device_count) : `${link.device_count} / ${max}`;
}

export const AUTO_REVEAL_NO_COUNT_HINT = "自动显示模式不计取码次数";

/** 取码次数（24h / 累计）：auto 方式不写取码记录，count 为 null（界面显示"—"并带说明），不显示恒为 0 的数字 */
export function deliveriesCell(
  link: Pick<AdminShareLink, "access">,
  count: number,
  title: string,
): { count: number | null; title: string } {
  return link.access.reveal === "auto" ? { count: null, title: AUTO_REVEAL_NO_COUNT_HINT } : { count, title };
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

export const EXTEND_UNITS = [
  { value: "day", label: "天", seconds: DAY },
  { value: "hour", label: "小时", seconds: HOUR },
] as const;
export type ExtendUnit = (typeof EXTEND_UNITS)[number]["value"];

export function unitSeconds(unit: ExtendUnit): number {
  return EXTEND_UNITS.find((candidate) => candidate.value === unit)?.seconds ?? MINUTE;
}
