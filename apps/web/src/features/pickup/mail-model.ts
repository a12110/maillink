import type { LinkDeliveryQuota, PresentedMail } from "@maillink/shared";
import { isHttpUrl } from "../mail";

// 取件页对 PresentedMail 的判读：显示什么、还能取几次。纯函数，便于测试。

export type CodeKind = "code" | "link" | "locked" | "empty";

export function kindOf(mail: PresentedMail): CodeKind {
  if (mail.locked === true) return "locked";
  if (mail.code !== undefined && mail.code !== "") return "code";
  if (mail.login_link !== undefined && mail.login_link !== "") return "link";
  return "empty";
}

/** 来源：发件人名称优先，其次域名、地址 */
export function originOf(mail: PresentedMail): string | null {
  return mail.sender?.name ?? mail.sender?.domain ?? mail.sender?.address ?? null;
}

/** 读屏逐位朗读：482910 → "4 8 2 9 1 0" */
export function speakCode(code: string): string {
  return Array.from(code).join(" ");
}

/** 登录链接只显示它会打开的域名，不显示完整 URL（完整地址含一次性令牌）。非 http(s) 返回 null */
export function linkDomain(link: string): string | null {
  if (!isHttpUrl(link)) return null;
  try {
    return new URL(link).hostname;
  } catch {
    return null;
  }
}

/** 取码方式为点击时，现在还能取几次：总次数与每日次数取较小者；不限为 null */
export function effectiveRemaining(deliveries: LinkDeliveryQuota | null): number | null {
  if (deliveries === null) return null;
  const values = [deliveries.total_remaining, deliveries.daily_remaining].filter((value): value is number => value !== null);
  return values.length === 0 ? null : Math.min(...values);
}

/** 「今日还可取 8 次（共 10 次）」「总共还可取 3 次」，同一封邮件重复查看不重复计次 */
export function quotaLines(deliveries: LinkDeliveryQuota | null): string[] {
  if (deliveries === null) return [];
  const lines: string[] = [];
  if (deliveries.daily_remaining !== null && deliveries.daily_limit !== null) {
    lines.push(`今日还可取 ${deliveries.daily_remaining} 次（共 ${deliveries.daily_limit} 次）`);
  }
  if (deliveries.total_remaining !== null && deliveries.total_limit !== null) {
    lines.push(`总共还可取 ${deliveries.total_remaining} 次（共 ${deliveries.total_limit} 次）`);
  }
  return lines;
}

/** 点击取码前的按钮 / 卡片文案里的剩余次数：「（剩余 N 次）」，不限次数时不写 */
export function remainingSuffix(deliveries: LinkDeliveryQuota | null): string {
  const remaining = effectiveRemaining(deliveries);
  return remaining === null ? "" : `（剩余 ${remaining} 次）`;
}

/** 点击取码已无次数可用：total = 总次数用尽（之后一切请求都是 410），daily = 仅每日上限用尽（按滚动 24 小时恢复） */
export type ExhaustedKind = "total" | "daily" | null;

export function exhaustedKind(deliveries: LinkDeliveryQuota | null, clickMode: boolean): ExhaustedKind {
  if (!clickMode || deliveries === null) return null;
  if (deliveries.total_remaining === 0) return "total";
  return deliveries.daily_remaining === 0 ? "daily" : null;
}
