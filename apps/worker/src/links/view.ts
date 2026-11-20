import type { AdminShareLink, ShareLinkAnomaly } from "@maillink/shared";
import { LINK_ANOMALY_COUNTRY_THRESHOLD } from "../constants";
import type { LinkMailboxRow, ShareLinkRow, ShareLinkStatsRow } from "../db/share-links";
import { accessView, parseStoredAccess } from "./access-config";

// 管理端链接对象的组装。

/** 当前生效的失效时间：绝对过期与"首次访问后 N 秒"取较早者；都没有（或尚未激活）为 null */
export function effectiveExpiresAt(row: Pick<ShareLinkRow, "expires_at" | "first_access_at" | "expire_after_first_access_sec">): number | null {
  const candidates: number[] = [];
  if (row.expires_at !== null) candidates.push(row.expires_at);
  if (row.first_access_at !== null && row.expire_after_first_access_sec !== null) {
    candidates.push(row.first_access_at + row.expire_after_first_access_sec);
  }
  return candidates.length === 0 ? null : Math.min(...candidates);
}

function anomalies(row: ShareLinkStatsRow, maxDevices: number | undefined): ShareLinkAnomaly[] {
  const found: ShareLinkAnomaly[] = [];
  if (maxDevices !== undefined && row.device_count >= maxDevices) found.push("device_limit_reached");
  if (row.country_count >= LINK_ANOMALY_COUNTRY_THRESHOLD) found.push("multi_country");
  return found;
}

export function toAdminLink(row: ShareLinkStatsRow, mailboxes: readonly LinkMailboxRow[]): AdminShareLink {
  const access = parseStoredAccess(row.access);
  return {
    id: row.id,
    name: row.name,
    order_ref: row.order_ref,
    public_title: row.public_title,
    public_note: row.public_note,
    token_hint: row.token_hint,
    rule_group: { id: row.rule_group_id, name: row.rule_group_name },
    status: row.status,
    state: row.state,
    valid_from: row.valid_from,
    expires_at: row.expires_at,
    expire_after_first_access_sec: row.expire_after_first_access_sec,
    effective_expires_at: effectiveExpiresAt(row),
    access: accessView(access),
    anchor_reset_at: row.anchor_reset_at,
    first_access_at: row.first_access_at,
    last_access_at: row.last_access_at,
    mailboxes: mailboxes.filter((mailbox) => mailbox.link_id === row.id).map(({ id, address, status }) => ({ id, address, status })),
    device_count: row.device_count,
    country_count: row.country_count,
    deliveries_24h: row.deliveries_24h,
    deliveries_total: row.deliveries_total,
    anomalies: anomalies(row, access.max_devices),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
