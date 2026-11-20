import type { VisibleMailListResponse } from "@maillink/shared";
import { listVisibleMails, type AccessScope } from "../access";
import { LIST_PAGE_SIZE } from "../constants";
import type { EffectiveGrantRow } from "../db/grants";
import { notFoundError } from "../errors";
import type { MailIndexDbs } from "../mail-index";
import { listAdminMails } from "../mail-source";
import { mergeAscending, mergeDescending, type ScopePage } from "./merge";
import { buildAllScopes, singleScope } from "./scopes";

// 用户收件箱列表：指定一个授权 = 该授权自己的作用域，直接走 access.listVisibleMails；
// "全部" = 把有效授权合成若干作用域，各取一页后用 merge.ts 合并。

export type MyListOptions = { mailbox?: number; cursor?: string; afterId?: number; now: number };

const FIRST_PAGE_SNAPSHOT_LIMIT = 1;

/** 查询开始前整个 MAIL_DB 里最大的邮件 id（没有邮件为 0）。id 单调递增，≤ 它的邮件对之后发起的所有查询都已就位 */
async function latestMailId(db: D1Database): Promise<number> {
  const [newest] = await listAdminMails(db, { scope: "all", limit: FIRST_PAGE_SNAPSHOT_LIMIT });
  return newest?.id ?? 0;
}

/**
 * 一个作用域的一页。设了 max_mails 的作用域是"最新 N 封，没有更多分页"：access 对带 cursor 的请求返回空，
 * 而合并后的第 2 页仍可能需要它的后几封，所以总是取整组（不带 cursor），再自己按 cursor 截。
 */
async function scopePage(dbs: MailIndexDbs, scope: AccessScope, options: MyListOptions): Promise<ScopePage> {
  const capped = scope.policy?.config.limits.max_mails !== undefined;
  if (!capped || options.afterId !== undefined) {
    return await listVisibleMails(dbs, scope, { cursor: options.cursor, afterId: options.afterId, now: options.now });
  }
  const page = await listVisibleMails(dbs, scope, { now: options.now });
  if (options.cursor === undefined) return page;
  const before = Number(options.cursor);
  return { ...page, items: page.items.filter((mail) => mail.id < before) };
}

async function listAll(dbs: MailIndexDbs, scopes: AccessScope[], options: MyListOptions): Promise<VisibleMailListResponse> {
  const { cursor, afterId } = options;
  // 增量轮询与首页要快照上界；翻页（cursor）不需要：它只看比游标更旧的邮件
  const snapshot = cursor === undefined ? await latestMailId(dbs.MAIL_DB) : null;
  const pages = await Promise.all(scopes.map((scope) => scopePage(dbs, scope, options)));
  if (afterId !== undefined && snapshot !== null) {
    const merged = mergeAscending(pages, { afterId, pageSize: LIST_PAGE_SIZE, snapshot });
    return { items: merged.items, next_cursor: null, partial: merged.partial, next_after_id: merged.next_after_id };
  }
  const merged = mergeDescending(pages, {
    pageSize: LIST_PAGE_SIZE,
    maxId: snapshot ?? undefined,
    requestCursor: cursor ?? null,
  });
  // 与单个作用域一致：只有没 partial 的首页给增量轮询起点，翻页不给
  const nextAfterId = snapshot !== null && !merged.partial ? snapshot : null;
  return { items: merged.items, next_cursor: merged.next_cursor, partial: merged.partial, next_after_id: nextAfterId };
}

export async function listMyMails(
  dbs: MailIndexDbs,
  grants: readonly EffectiveGrantRow[],
  options: MyListOptions,
): Promise<VisibleMailListResponse> {
  if (options.mailbox !== undefined) {
    // 不是自己的有效授权（别人的 / 已删除 / 已过期 / 地址停用）一律同一个 404
    const grant = grants.find((row) => row.id === options.mailbox);
    if (!grant) throw notFoundError("邮箱不存在");
    return await listVisibleMails(dbs, singleScope(grant), { cursor: options.cursor, afterId: options.afterId, now: options.now });
  }
  const scopes = buildAllScopes(grants, options.now);
  const [only] = scopes;
  if (only && scopes.length === 1) {
    return await listVisibleMails(dbs, only, { cursor: options.cursor, afterId: options.afterId, now: options.now });
  }
  if (scopes.length === 0) {
    return { items: [], next_cursor: null, partial: false, next_after_id: options.afterId ?? null };
  }
  return await listAll(dbs, scopes, options);
}
