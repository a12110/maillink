import type { MyMailListItem, MyMailListResponse, PresentedMail, VisibleMailListResponse } from "@maillink/shared";
import { effectivePolicy, listVisibleMailsTagged, type AccessScope, type ListVisibleOptions, type ParseBudget } from "../access";
import { LIST_PAGE_SIZE, MAX_PARSE_PER_REQUEST } from "../constants";
import type { EffectiveGrantRow } from "../db/grants";
import { notFoundError } from "../errors";
import type { MailIndexDbs } from "../mail-index";
import { latestMailId } from "../mail-source";
import { mergeAscending, mergeDescending, type ScopePage } from "./merge";
import { buildAllScopes, singleScope } from "./scopes";

// 用户收件箱列表：指定一个授权 = 该授权自己的作用域，直接走 access 的列表；
// "全部" = 把有效授权合成若干作用域，各取一页后用 merge.ts 合并。
// 每个列表项都带所属授权的 mailbox_id 与视图模式（前端据此决定有无详情、打开详情时带哪个 mailbox_id）。

/** mailboxId 是收件地址 id；同一用户对同一地址最多一条授权，足以唯一定位授权 */
export type MyListOptions = { mailboxId?: number; cursor?: string; afterId?: number; now: number };

/** 每封邮件的归属：mail id → { mailbox_id, view }；只用于给响应项打标签 */
type Owners = Map<number, Pick<MyMailListItem, "mailbox_id" | "view">>;

type ListContext = {
  dbs: MailIndexDbs;
  /** 收件地址（全小写）→ 授权。MAIL_DB 的收件人口径见 locate.ts：全小写写法总在候选写法里 */
  byAddress: Map<string, EffectiveGrantRow>;
  owners: Owners;
  parseBudget: ParseBudget;
};

/** 拉一个作用域的一页，并把返回邮件的归属记进 owners */
async function taggedPage(ctx: ListContext, scope: AccessScope, options: ListVisibleOptions): Promise<VisibleMailListResponse> {
  const { response, recipients } = await listVisibleMailsTagged(ctx.dbs, scope, options);
  const { view } = effectivePolicy(scope, options.now).compiled.config.present;
  for (const [mailId, recipient] of recipients) {
    const grant = ctx.byAddress.get(recipient);
    // 作用域的地址都来自这些授权，对不上说明归属口径出了错：失败关闭，不猜
    if (!grant) throw new Error(`mail ${mailId}: 收件地址 ${recipient} 不属于任何授权`);
    ctx.owners.set(mailId, { mailbox_id: grant.mailbox_id, view });
  }
  return response;
}

function withOwners(page: VisibleMailListResponse, owners: Owners): MyMailListResponse {
  const tag = (mail: PresentedMail): MyMailListItem => {
    const owner = owners.get(mail.id);
    if (!owner) throw new Error(`mail ${mail.id}: 缺少归属授权`);
    return { ...mail, ...owner };
  };
  return { ...page, items: page.items.map(tag) };
}

/**
 * 一个作用域的一页。设了 max_mails 的作用域是"最新 N 封，没有更多分页"：access 对带 cursor 的请求返回空，
 * 而合并后的第 2 页仍可能需要它的后几封，所以总是取整组（不带 cursor），再自己按 cursor 截。
 */
async function scopePage(ctx: ListContext, scope: AccessScope, options: MyListOptions): Promise<ScopePage> {
  const capped = scope.policy?.config.limits.max_mails !== undefined;
  const base = { now: options.now, parseBudget: ctx.parseBudget };
  if (!capped || options.afterId !== undefined) {
    return await taggedPage(ctx, scope, { ...base, cursor: options.cursor, afterId: options.afterId });
  }
  const page = await taggedPage(ctx, scope, base);
  if (options.cursor === undefined) return page;
  const before = Number(options.cursor);
  return { ...page, items: page.items.filter((mail) => mail.id < before) };
}

async function listAll(ctx: ListContext, scopes: AccessScope[], options: MyListOptions): Promise<VisibleMailListResponse> {
  const { cursor, afterId } = options;
  // 增量轮询与首页要快照上界；翻页（cursor）不需要：它只看比游标更旧的邮件
  const snapshot = cursor === undefined ? await latestMailId(ctx.dbs.MAIL_DB) : null;
  // 顺序扫描，并共用一份解析预算：一次请求的现场解析量与单个作用域相同，不随作用域数放大。
  // 预算用完后，后面的作用域只能用已建好的索引，遇到没解析的邮件就是 pending → partial，客户端重取时继续推进
  const pages: ScopePage[] = [];
  for (const scope of scopes) pages.push(await scopePage(ctx, scope, options));
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
): Promise<MyMailListResponse> {
  const ctx: ListContext = {
    dbs,
    byAddress: new Map(grants.map((grant) => [grant.address.trim().toLowerCase(), grant])),
    owners: new Map(),
    parseBudget: { remaining: MAX_PARSE_PER_REQUEST },
  };
  const single = { cursor: options.cursor, afterId: options.afterId, now: options.now };
  if (options.mailboxId !== undefined) {
    // 不是自己的有效授权（别人的 / 已删除 / 已过期 / 地址停用）一律同一个 404
    const grant = grants.find((row) => row.mailbox_id === options.mailboxId);
    if (!grant) throw notFoundError("邮箱不存在");
    return withOwners(await taggedPage(ctx, singleScope(grant), single), ctx.owners);
  }
  const scopes = buildAllScopes(grants, options.now);
  const [only] = scopes;
  if (only && scopes.length === 1) {
    return withOwners(await taggedPage(ctx, only, single), ctx.owners);
  }
  if (scopes.length === 0) {
    return { items: [], next_cursor: null, partial: false, next_after_id: options.afterId ?? null };
  }
  return withOwners(await listAll(ctx, scopes, options), ctx.owners);
}
