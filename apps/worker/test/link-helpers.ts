import { env } from "cloudflare:workers";
import type { MailboxImportResponse, RuleGroupConfigInput, RuleGroupSaveResponse, ShareLinkCreate, ShareLinkCreateResponse } from "@maillink/shared";
import { baseConfig } from "./access-helpers";
import { app } from "../src/index";
import { api, type ApiOptions } from "./helpers";

// 取件链接测试的公共构造器。

export type ErrorBody = { error: { code: string; message: string; [key: string]: unknown } };

export async function importMailboxes(cookie: string, addresses: string[]): Promise<Map<string, number>> {
  const res = await api("/api/admin/mailboxes/import", { cookie, json: { content: addresses.join("\n") } });
  if (res.status !== 201) throw new Error(`导入失败 ${res.status}: ${await res.text()}`);
  await res.json<MailboxImportResponse>();
  const { results } = await env.APP_DB.prepare("SELECT id, address FROM mailboxes").all<{ id: number; address: string }>();
  return new Map(results.map((row) => [row.address, row.id]));
}

let groupCounter = 0;

export async function createRuleGroup(cookie: string, config: RuleGroupConfigInput = baseConfig()): Promise<number> {
  groupCounter += 1;
  const res = await api("/api/admin/rule-groups", { cookie, json: { name: `group-${groupCounter}`, config } });
  if (res.status !== 201) throw new Error(`建规则组失败 ${res.status}: ${await res.text()}`);
  return (await res.json<RuleGroupSaveResponse>()).rule_group.id;
}

export async function createLinks(cookie: string, body: ShareLinkCreate): Promise<ShareLinkCreateResponse> {
  const res = await api("/api/admin/links", { cookie, json: body });
  if (res.status !== 201) throw new Error(`建链接失败 ${res.status}: ${await res.text()}`);
  return await res.json<ShareLinkCreateResponse>();
}

/** 建一个链接，返回 id 与 token */
export async function createLink(cookie: string, body: ShareLinkCreate): Promise<{ id: number; token: string }> {
  const created = await createLinks(cookie, body);
  const first = created.items[0];
  if (!first) throw new Error("没有建出链接");
  return { id: first.link.id, token: first.token };
}

export type Visitor = { ip?: string; country?: string; cookie?: string };

function publicHeaders(method: string, visitor: Visitor, options: ApiOptions): Headers {
  const headers = new Headers(options.headers);
  if (method !== "GET") {
    headers.set("Origin", env.PUBLIC_ORIGIN);
    headers.set("X-MailLink-Csrf", "1");
  }
  headers.set("CF-Connecting-IP", visitor.ip ?? "203.0.113.7");
  if (visitor.cookie) headers.set("Cookie", visitor.cookie);
  if (options.json !== undefined) headers.set("Content-Type", "application/json");
  return headers;
}

/** 公开接口请求：可指定来源 IP、国家（request.cf.country）与访客 Cookie */
export async function publicApi(path: string, visitor: Visitor = {}, options: ApiOptions = {}): Promise<Response> {
  const method = options.method ?? (options.json === undefined ? "GET" : "POST");
  // 国家来自 request.cf.country：workerd 的 Request 构造函数接受 cf 属性，测试里用它注入
  const request = new Request(`http://localhost${path}`, {
    method,
    headers: publicHeaders(method, visitor, options),
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
    cf: visitor.country === undefined ? undefined : { country: visitor.country },
  });
  return await app.fetch(request, env);
}

/** start 成功后从 Set-Cookie 取 `mlv_<id>=...` */
export function visitorCookie(res: Response): string {
  const line = res.headers.getSetCookie().find((value) => value.startsWith("mlv_"));
  if (!line) throw new Error("响应里没有访客 Cookie");
  return line.split(";")[0] ?? "";
}

export async function tableCounts(): Promise<Record<string, number>> {
  const tables = ["share_links", "link_visitors", "link_deliveries", "link_access_logs", "audit_logs"];
  const entries = await Promise.all(
    tables.map(async (table) => [table, (await env.APP_DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0] as const),
  );
  return Object.fromEntries(entries);
}

export async function linkRow(id: number): Promise<Record<string, unknown>> {
  const row = await env.APP_DB.prepare("SELECT * FROM share_links WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!row) throw new Error(`链接 ${id} 不存在`);
  return row;
}

export async function accessLogs(linkId: number): Promise<Array<{ event: string; reason: string | null; mail_id: number | null }>> {
  const { results } = await env.APP_DB
    .prepare("SELECT event, reason, mail_id FROM link_access_logs WHERE link_id = ? ORDER BY id")
    .bind(linkId)
    .all<{ event: string; reason: string | null; mail_id: number | null }>();
  return results;
}
