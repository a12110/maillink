import type { LinkPageState, LinkPublicStatus, PresentedMail } from "@maillink/shared";
import type { AccessScope } from "../access";
import { listVisibleMailsTagged } from "../access";
import { ApiError, notFoundError } from "../errors";
import { HTTP_SERVICE_UNAVAILABLE } from "../http-status";
import type { MailIdentity, MailIndexDbs } from "../mail-index";
import { maskAddress } from "../render";
import { loadPickupSettings } from "./pickup-settings";
import type { LinkRequest } from "./request";
import { deliveryQuota } from "./request";
import type { LinkScope } from "./scope";
import { effectiveExpiresAt } from "./view";
import { devicesFull, type VisitorState } from "./visitor";

// 取件页状态（05 §3 取件页状态表）与 reveal 用的单封可见性判定。

async function pageState(db: D1Database, req: LinkRequest, scope: LinkScope, visitor: VisitorState, dailyExhausted: boolean): Promise<LinkPageState> {
  if (scope.mailboxCount === 0) return "no_mailbox";
  if (!visitor.registered) return (await devicesFull(db, req)) ? "device_limit" : "needs_start";
  return dailyExhausted ? "daily_limit" : "active";
}

/** 设了口令的链接在本浏览器通过口令（登记为设备）之前不给收件地址，只给数量 */
function displayMailboxes(scope: LinkScope, req: LinkRequest, visitor: VisitorState): string[] {
  if (req.access.password_hash !== undefined && !visitor.registered) return [];
  const mode = scope.compiled.config.present.recipient;
  if (mode === "hidden") return [];
  return mode === "masked" ? scope.scope.addresses.map(maskAddress) : [...scope.scope.addresses];
}

export async function buildPublicStatus(db: D1Database, req: LinkRequest, scope: LinkScope, visitor: VisitorState): Promise<LinkPublicStatus> {
  const quota = deliveryQuota(req.access, req.counts);
  const state = await pageState(db, req, scope, visitor, quota?.daily_resets_at != null);
  const { row, access } = req;
  return {
    state,
    activated: row.first_access_at !== null,
    visitor_registered: visitor.registered,
    requires_password: access.password_hash !== undefined,
    requires_turnstile: access.turnstile,
    ...(await loadPickupSettings(db, access)),
    view: scope.compiled.config.present.view,
    reveal: access.reveal,
    deliveries: quota,
    poll_interval_sec: access.poll_interval_sec,
    mailboxes: displayMailboxes(scope, req, visitor),
    mailbox_count: scope.mailboxCount,
    recipient_display: scope.compiled.config.present.recipient,
    expires_at: effectiveExpiresAt(row),
    expire_after_first_access_sec: row.first_access_at === null ? row.expire_after_first_access_sec : null,
    public_title: row.public_title,
    public_note: row.public_note,
    retry_after_at: state === "daily_limit" ? (quota?.daily_resets_at ?? null) : null,
    max_devices: state === "device_limit" ? (access.max_devices ?? null) : null,
  };
}

/**
 * reveal 前判定某封邮件对本链接可见：用列表同一个函数，以 after_id = id − 1 增量求值，结果里必须有这封。
 * 这样地址归属、时间下界、规则、max_mails 都与访问者看到的列表同一口径，没有第二套逻辑。
 * 这封还没解析到（partial）时返回 503 让前端稍后重试，不当作不可见。
 * 同时给出这封的邮件身份，取码记录据此区分"同一封"与"复用了 id 的新邮件"。
 */
export async function findVisibleListItem(
  dbs: MailIndexDbs,
  scope: AccessScope,
  mailId: number,
  now: number,
): Promise<{ mail: PresentedMail; identity: MailIdentity }> {
  const { response: result, identities } = await listVisibleMailsTagged(dbs, scope, { afterId: mailId - 1, now });
  const item = result.items.find((mail) => mail.id === mailId);
  if (item !== undefined) {
    const identity = identities.get(mailId);
    if (identity === undefined) throw new Error(`mail ${mailId}: 列表里有这封却没有邮件身份`);
    return { mail: item, identity };
  }
  if (result.partial) throw new ApiError(HTTP_SERVICE_UNAVAILABLE, "mail_not_ready", "邮件还在处理，请稍后重试");
  throw notFoundError("邮件不存在");
}
