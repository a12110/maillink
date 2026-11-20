import { LINK_PUBLIC_ERRORS } from "@maillink/shared";
import { NetworkError, ResponseFormatError } from "../../api/errors";
import { describeError } from "../../lib/messages";
import { formatDateTime } from "../../lib/format";
import { PickupError } from "./pickup-api";

// 取件页的错误 → 页面状态映射（PLAN 裁定：404 不存在、410 统一"已失效"、403 未到生效时间；其余流程类就地提示）。

export type PageFailure =
  | { kind: "not_found" }
  | { kind: "unavailable" }
  | { kind: "not_yet_valid"; validFrom: number | null }
  | { kind: "device_limit"; publicNote: string | null }
  | { kind: "daily_limit"; retryAfterAt: number | null }
  | { kind: "start_required" }
  | { kind: "no_mailbox" }
  | { kind: "other"; error: unknown };

function numberExtra(error: PickupError, key: string): number | null {
  const value = error.extra[key];
  return typeof value === "number" ? value : null;
}

/** 按错误码（不是只看状态码）分类：未知错误一律 other，带原因展示，不冒充"已失效" */
export function classifyPickupError(error: unknown): PageFailure {
  if (!(error instanceof PickupError)) return { kind: "other", error };
  switch (error.code) {
    case LINK_PUBLIC_ERRORS.notFound:
      return { kind: "not_found" };
    case LINK_PUBLIC_ERRORS.unavailable:
      return { kind: "unavailable" };
    case LINK_PUBLIC_ERRORS.notYetValid:
      return { kind: "not_yet_valid", validFrom: numberExtra(error, "valid_from") };
    case LINK_PUBLIC_ERRORS.deviceLimit: {
      const note = error.extra.public_note;
      return { kind: "device_limit", publicNote: typeof note === "string" ? note : null };
    }
    case LINK_PUBLIC_ERRORS.dailyLimit:
      return { kind: "daily_limit", retryAfterAt: numberExtra(error, "retry_after_at") };
    case LINK_PUBLIC_ERRORS.startRequired:
      return { kind: "start_required" };
    case LINK_PUBLIC_ERRORS.noMailbox:
      return { kind: "no_mailbox" };
    default:
      return { kind: "other", error };
  }
}

export type InlineProblem = { message: string; detail: string };

/** 公开接口的错误：服务端文案 + 错误码；其他错误沿用统一描述 */
export function describePickupError(error: unknown): InlineProblem {
  if (error instanceof PickupError) return { message: error.message, detail: `${error.code} · HTTP ${error.status}` };
  return describeError(error);
}

/** "开始取码"的就地错误：口令缺失 / 错误 / 锁定（400 / 403 / 429）、人机验证失败、限流 */
export function describeStartError(error: unknown, now: Date = new Date()): InlineProblem {
  if (!(error instanceof PickupError)) return describeError(error);
  const detail = `${error.code} · HTTP ${error.status}`;
  switch (error.code) {
    case LINK_PUBLIC_ERRORS.passwordRequired:
      return { message: "请输入访问口令", detail };
    case LINK_PUBLIC_ERRORS.passwordInvalid:
      return { message: "访问口令不正确，请向卖家确认后重试", detail };
    case LINK_PUBLIC_ERRORS.passwordLocked: {
      const retryAt = numberExtra(error, "retry_after_at");
      const when = retryAt === null ? "稍后" : `${formatDateTime(retryAt, now)} 之后`;
      return { message: `口令错误次数过多，已暂时锁定，请${when}再试`, detail };
    }
    case "turnstile_failed":
      return { message: "人机验证未通过，请重新验证", detail };
    case LINK_PUBLIC_ERRORS.turnstileNotConfigured:
      return { message: "人机验证暂不可用，请联系卖家", detail };
    case "rate_limited":
      return { message: "操作太频繁，请稍等一会儿再试", detail };
    default:
      return describePickupError(error);
  }
}

/** 取码（reveal）与轮询的就地错误 */
export function describeMailError(error: unknown): InlineProblem {
  if (error instanceof PickupError) {
    const detail = `${error.code} · HTTP ${error.status}`;
    if (error.code === "mail_not_ready") return { message: "邮件还在处理，请稍后重试", detail };
    if (error.code === "rate_limited") return { message: "刷新太频繁，稍后会自动重试", detail };
    if (error.code === LINK_PUBLIC_ERRORS.revealNotApplicable) return { message: "这个链接的邮件会自动显示，不需要点击取码", detail };
    if (error.status === 404) return { message: "这封邮件已不可见", detail };
  }
  return describePickupError(error);
}

export function isNetworkProblem(error: unknown): boolean {
  return error instanceof NetworkError || error instanceof ResponseFormatError;
}
