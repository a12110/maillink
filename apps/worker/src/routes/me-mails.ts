import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import {
  myMailDetailQuerySchema,
  myMailListQuerySchema,
  type MyMailbox,
  type MyMailboxListResponse,
} from "@maillink/shared";
import { getVisibleAttachment, getVisibleMailDetail, type AccessScope } from "../access";
import { nowSec } from "../clock";
import { listEffectiveGrantRows, markGrantsFirstAccess, type EffectiveGrantRow } from "../db/grants";
import type { AppEnv } from "../env";
import { HTTP_OK } from "../http-status";
import { listMyMails } from "../inbox/list";
import { locateGrantForMail } from "../inbox/locate";
import { singleScope, tryCompileGrant } from "../inbox/scopes";
import type { CompiledRuleGroup } from "../rules";
import { requireUser } from "../middleware/auth";
import { maskAddress } from "../render";
import { parseIdParam, parseQuery, parseWith } from "../validate";
import { attachmentDisposition } from "./content-disposition";

// 当前用户的收件箱（04 当前用户 / mailboxes、mails）。
// 与 me.ts 分开挂载（index.ts 按路径挂在 /api/me/mailboxes 与 /api/me/mails），各自带 requireUser。
// 授权只认"当前有效"的：未过期且收件地址启用；别人的、已删除的、已过期的、地址已停用的一律不存在（404 / 不在列表）。

export const meMailboxRoutes = new Hono<AppEnv>();
export const meMailRoutes = new Hono<AppEnv>();

for (const routes of [meMailboxRoutes, meMailRoutes]) {
  routes.use("*", requireUser);
  // 邮件相关响应一律不缓存（04 约定）
  routes.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
}

const UNAVAILABLE_MAILBOX = (grant: EffectiveGrantRow): MyMailbox => ({
  grant_id: grant.id,
  mailbox_id: grant.mailbox_id,
  address: null,
  label: null,
  recipient: null,
  view: null,
  expires_at: grant.expires_at,
  available: false,
});

/** 收件地址按授权规则组的 recipient 设置显示；hidden 时不给地址与名称（名称常是地址的别名） */
function toMyMailbox(grant: EffectiveGrantRow, compiled: CompiledRuleGroup | null): MyMailbox {
  if (compiled === null) return UNAVAILABLE_MAILBOX(grant);
  const { recipient, view } = compiled.config.present;
  const shown = recipient === "full" ? grant.address : recipient === "masked" ? maskAddress(grant.address) : null;
  return {
    grant_id: grant.id,
    mailbox_id: grant.mailbox_id,
    address: shown,
    label: recipient === "full" ? grant.label : null,
    recipient,
    view,
    expires_at: grant.expires_at,
    available: true,
  };
}

meMailboxRoutes.get("/", async (c) => {
  const grants = await listEffectiveGrantRows(c.env.APP_DB, c.var.auth.user.id, nowSec());
  const compiledByGroup = new Map<number | null, CompiledRuleGroup | null>();
  const items = grants.map((grant) => {
    if (!compiledByGroup.has(grant.rule_group_id)) compiledByGroup.set(grant.rule_group_id, tryCompileGrant(grant));
    return toMyMailbox(grant, compiledByGroup.get(grant.rule_group_id) ?? null);
  });
  const body: MyMailboxListResponse = { items, next_cursor: null };
  return c.json(body, HTTP_OK);
});

/**
 * 列表。授权的"首次访问"在用户第一次请求该授权的邮件列表时写入（"全部"覆盖的有效授权一并写入）。
 * 先用写入前的授权构造作用域并取到结果，成功之后才写库：422 / 503 / 404 的失败请求不写。
 * 写入前 first_access_at 为 null，时间下界按 now 计算，与稍后写入的值（同一个 now）一致。详情与附件不写。
 * 为什么对授权可以这样做、取件链接却不行：授权必须是已登录的本人才能读，第一次列表就是本人第一次真的看；
 * 取件链接是持链接即可访问的凭据，打开页面可能是 IM 链接预览、爬虫或买家之外的人，所以链接的首次访问
 * 要等"开始取码"这个明确动作（02 §3.1、§6），不能由一次 GET 触发。
 */
meMailRoutes.get("/", async (c) => {
  const query = parseQuery(c, myMailListQuerySchema);
  const db = c.env.APP_DB;
  const { id: userId } = c.var.auth.user;
  const now = nowSec();
  const grants = await listEffectiveGrantRows(db, userId, now);
  const body = await listMyMails(c.env, grants, { mailboxId: query.mailbox_id, cursor: query.cursor, afterId: query.after_id, now });
  await markGrantsFirstAccess(db, userId, query.mailbox_id ?? null, now);
  return c.json(body, HTTP_OK);
});

/** 定位授权并构造作用域；之后的详情 / 附件判定都在这个作用域里重走完整流水线 */
async function scopeForMail(c: Context<AppEnv>, mailId: number, now: number): Promise<AccessScope> {
  const { mailbox_id: mailboxId } = parseWith(myMailDetailQuerySchema, { mailbox_id: c.req.query("mailbox_id") });
  const grants = await listEffectiveGrantRows(c.env.APP_DB, c.var.auth.user.id, now);
  return singleScope(await locateGrantForMail(c.env, grants, mailId, mailboxId));
}

meMailRoutes.get("/:id", async (c) => {
  const id = parseIdParam(c);
  const now = nowSec();
  const scope = await scopeForMail(c, id, now);
  return c.json(await getVisibleMailDetail(c.env, scope, id, { now }), HTTP_OK);
});

const attachmentParamsSchema = z.object({ index: z.coerce.number().int().nonnegative() });

meMailRoutes.get("/:id/attachments/:index", async (c) => {
  const id = parseIdParam(c);
  const { index } = parseWith(attachmentParamsSchema, { index: c.req.param("index") });
  const now = nowSec();
  const scope = await scopeForMail(c, id, now);
  const { filename, content } = await getVisibleAttachment(c.env, scope, id, index, { now });
  return new Response(content, {
    status: HTTP_OK,
    headers: {
      // 不信任邮件里声明的类型：一律当二进制下载，并禁止浏览器嗅探
      "Content-Type": "application/octet-stream",
      "Content-Disposition": attachmentDisposition(filename, `attachment-${index}`),
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(content.byteLength),
    },
  });
});
