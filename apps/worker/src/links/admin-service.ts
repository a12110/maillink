import type { AdminShareLink, LinkAccessStored, ShareLinkCreate } from "@maillink/shared";
import { nowSec } from "../clock";
import { findMailboxRefs, findShareLinkStats, findShareLinksStats, listLinkMailboxes, ruleGroupExists, type MailboxRef } from "../db/share-links";
import { ApiError, notFoundError } from "../errors";
import { HTTP_BAD_REQUEST } from "../http-status";
import { toAdminLink } from "./view";

// 管理端链接接口共用的读取与校验。

export async function loadAdminLink(db: D1Database, id: number, now: number = nowSec()): Promise<AdminShareLink> {
  const row = await findShareLinkStats(db, id, now);
  if (!row) throw notFoundError("取件链接不存在");
  return toAdminLink(row, await listLinkMailboxes(db, [id]));
}

export async function loadAdminLinks(db: D1Database, ids: readonly number[], now: number = nowSec()): Promise<AdminShareLink[]> {
  const rows = await findShareLinksStats(db, ids, now);
  const mailboxes = await listLinkMailboxes(db, ids);
  const byId = new Map(rows.map((row) => [row.id, toAdminLink(row, mailboxes)]));
  return ids.map((id) => {
    const link = byId.get(id);
    if (!link) throw new Error(`链接 ${id} 读取失败`);
    return link;
  });
}

export async function requireRuleGroupId(db: D1Database, id: number): Promise<void> {
  if (!(await ruleGroupExists(db, id))) {
    throw new ApiError(HTTP_BAD_REQUEST, "rule_group_not_found", `规则组 ${id} 不存在`);
  }
}

/** 所有收件地址都必须存在；返回顺序与入参一致 */
export async function requireMailboxes(db: D1Database, ids: readonly number[], now: number): Promise<MailboxRef[]> {
  const refs = await findMailboxRefs(db, ids, now);
  const byId = new Map(refs.map((ref) => [ref.id, ref]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new ApiError(HTTP_BAD_REQUEST, "mailbox_not_found", `收件地址不存在：${missing.join(", ")}`);
  }
  return ids.map((id) => byId.get(id) as MailboxRef);
}

/** 一址一链：每个地址一组；一链多址：全部一组 */
export function groupMailboxes(mode: NonNullable<ShareLinkCreate["mode"]>, ids: readonly number[]): number[][] {
  return mode === "combined" ? [[...ids]] : ids.map((id) => [id]);
}

/** PATCH 合并后的生效时间窗口仍要满足 valid_from < expires_at */
export function assertWindow(validFrom: number | null, expiresAt: number | null): void {
  if (validFrom !== null && expiresAt !== null && validFrom >= expiresAt) {
    throw new ApiError(HTTP_BAD_REQUEST, "validation_error", "expires_at: valid_from 必须早于 expires_at");
  }
}

/** 审计里描述访问约束：不含口令哈希 */
export function auditAccess(access: LinkAccessStored): Record<string, unknown> {
  const { password_hash: passwordHash, ...rest } = access;
  return { ...rest, has_password: passwordHash !== undefined };
}
