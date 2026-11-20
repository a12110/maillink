import { builtinRuleGroupTemplates, type LinkApiCodeResponse, type RuleGroupConfigInput, type ShareLinkCreate } from "@maillink/shared";
import { putMail } from "./access-helpers";
import { createLink, createRuleGroup, publicApi, type ErrorBody, type Visitor } from "./link-helpers";
import type { ApiOptions } from "./helpers";

// API 取码（GET /api/s/:token/code）测试的公共构造器。

export function codeOnlyConfig(): RuleGroupConfigInput {
  const template = builtinRuleGroupTemplates().find((item) => item.key === "code_only");
  if (!template) throw new Error("缺少仅验证码模板");
  return { ...template.config, time: { since: { type: "none" } } };
}

export async function linkWith(
  cookie: string,
  mailboxId: number,
  config: RuleGroupConfigInput,
  extra: Partial<ShareLinkCreate> = {},
): Promise<{ id: number; token: string }> {
  const groupId = await createRuleGroup(cookie, config);
  return await createLink(cookie, { mailbox_ids: [mailboxId], rule_group_id: groupId, ...extra });
}

export const codeMail = (code: string, ageSec = 0, address = "box@example.com") =>
  putMail({ address, from: "noreply@login.example.org", subject: "Sign in", text: `Your verification code is ${code}`, ageSec });

export const plainMail = (ageSec = 0, address = "box@example.com") =>
  putMail({ address, from: "news@example.org", subject: "Weekly news", text: "Nothing to see here, just a newsletter.", ageSec });

export type ApiCallOptions = { query?: string; password?: string; visitor?: Visitor; bindings?: ApiOptions["bindings"] };

export function apiCode(token: string, options: ApiCallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = options.password === undefined ? {} : { "X-Link-Password": options.password };
  return publicApi(`/api/s/${token}/code${options.query ?? ""}`, options.visitor ?? {}, { headers, bindings: options.bindings });
}

export async function apiCodeOk(token: string, options: ApiCallOptions = {}): Promise<LinkApiCodeResponse> {
  const res = await apiCode(token, options);
  if (res.status !== 200) throw new Error(`API 取码失败 ${res.status}: ${await res.text()}`);
  return await res.json<LinkApiCodeResponse>();
}

export async function apiError(res: Response): Promise<{ status: number; code: string; body: ErrorBody["error"] }> {
  const { error } = await res.json<ErrorBody>();
  return { status: res.status, code: error.code, body: error };
}
