import { LINK_PUBLIC_ERRORS, cidrContains, parseCidr, parseIp, unmapIpv4, type LinkAccessStored } from "@maillink/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ClientInfo } from "../db/link-activity";
import type { ShareLinkRow } from "../db/share-links";
import { ApiError } from "../errors";
import {
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_FORBIDDEN,
  HTTP_GONE,
  HTTP_NOT_FOUND,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_UNAUTHORIZED,
} from "../http-status";

// 公开取件接口的访问检查（02 §6）与对外错误。具体原因只写进 link_access_logs，对外只给统一的几种错误。

/** 写进 link_access_logs.reason 的具体原因 */
export type DenyReason =
  | "revoked"
  | "paused"
  | "expired"
  | "expired_after_first_access"
  | "not_yet_valid"
  | "ip_denied"
  | "country_denied"
  | "total_limit"
  | "device_limit"
  | "daily_limit"
  | "bad_password"
  | "password_locked"
  | "password_required"
  | "no_mailbox"
  | "start_required"
  | "turnstile_unavailable";

/** 对外统一成"已失效"的原因（PLAN 裁定：撤销 / 暂停 / 过期 / 总次数用尽；IP 与国家白名单同样不透露） */
const UNAVAILABLE_REASONS: ReadonlySet<DenyReason> = new Set([
  "revoked",
  "paused",
  "expired",
  "expired_after_first_access",
  "ip_denied",
  "country_denied",
  "total_limit",
]);

export class LinkDenied extends ApiError {
  constructor(
    readonly reason: DenyReason,
    status: ContentfulStatusCode,
    code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(status, code, message);
    this.name = "LinkDenied";
  }
}

type Spec = { status: ContentfulStatusCode; code: string; message: string };

const SPECS: Record<Exclude<DenyReason, "revoked" | "paused" | "expired" | "expired_after_first_access" | "ip_denied" | "country_denied" | "total_limit">, Spec> = {
  not_yet_valid: { status: HTTP_FORBIDDEN, code: LINK_PUBLIC_ERRORS.notYetValid, message: "链接尚未到生效时间" },
  device_limit: { status: HTTP_FORBIDDEN, code: LINK_PUBLIC_ERRORS.deviceLimit, message: "这个链接可使用的设备数已满，请联系链接提供者" },
  daily_limit: { status: HTTP_TOO_MANY_REQUESTS, code: LINK_PUBLIC_ERRORS.dailyLimit, message: "今日取码次数已用完，请稍后再试" },
  bad_password: { status: HTTP_FORBIDDEN, code: LINK_PUBLIC_ERRORS.passwordInvalid, message: "访问口令不正确" },
  password_locked: { status: HTTP_TOO_MANY_REQUESTS, code: LINK_PUBLIC_ERRORS.passwordLocked, message: "口令错误次数过多，请稍后再试" },
  password_required: { status: HTTP_BAD_REQUEST, code: LINK_PUBLIC_ERRORS.passwordRequired, message: "需要输入访问口令" },
  no_mailbox: { status: HTTP_CONFLICT, code: LINK_PUBLIC_ERRORS.noMailbox, message: "这个链接暂无可用的邮箱，请联系链接提供者" },
  start_required: { status: HTTP_UNAUTHORIZED, code: LINK_PUBLIC_ERRORS.startRequired, message: "请先点击\"开始取码\"" },
  turnstile_unavailable: { status: HTTP_SERVICE_UNAVAILABLE, code: LINK_PUBLIC_ERRORS.turnstileNotConfigured, message: "人机验证暂不可用" },
};

export function denial(reason: DenyReason, extra: Record<string, unknown> = {}): LinkDenied {
  if (UNAVAILABLE_REASONS.has(reason)) {
    return new LinkDenied(reason, HTTP_GONE, LINK_PUBLIC_ERRORS.unavailable, "链接已失效");
  }
  const spec = SPECS[reason as keyof typeof SPECS];
  return new LinkDenied(reason, spec.status, spec.code, spec.message, extra);
}

export function linkNotFound(): ApiError {
  return new ApiError(HTTP_NOT_FOUND, LINK_PUBLIC_ERRORS.notFound, "链接不存在");
}

/** 状态 → 生效 / 过期（含首次访问后过期）。过期优先于未生效 */
export function checkStatusAndTime(row: ShareLinkRow, now: number): DenyReason | null {
  if (row.status === "revoked") return "revoked";
  if (row.status === "paused") return "paused";
  if (row.expires_at !== null && row.expires_at <= now) return "expired";
  if (row.first_access_at !== null && row.expire_after_first_access_sec !== null && row.first_access_at + row.expire_after_first_access_sec <= now) {
    return "expired_after_first_access";
  }
  if (row.valid_from !== null && row.valid_from > now) return "not_yet_valid";
  return null;
}

/** IP / 国家白名单。拿不到来源 IP 或国家时按不在白名单处理（失败关闭） */
export function checkNetwork(access: LinkAccessStored, client: ClientInfo): DenyReason | null {
  if (access.ip_allow.length > 0) {
    const parsed = client.ip === null ? null : parseIp(client.ip);
    const ip = parsed === null ? null : unmapIpv4(parsed);
    const allowed = ip !== null && access.ip_allow.some((text) => {
      const cidr = parseCidr(text);
      if (cidr === null) throw new Error(`share_links.access.ip_allow 含无效 CIDR：${text}`);
      return cidrContains(cidr, ip);
    });
    if (!allowed) return "ip_denied";
  }
  if (access.country_allow.length > 0 && (client.country === null || !access.country_allow.includes(client.country.toUpperCase()))) {
    return "country_denied";
  }
  return null;
}
