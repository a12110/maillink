import { grantBatchRequestSchema, GRANT_BATCH_MAX_MAILBOXES, GRANT_BATCH_MAX_USERS } from "@maillink/shared";
import type { GrantBatchRequest, GrantBatchResponse } from "@maillink/shared";
import { parseExpiresLocal, reasonLabel } from "../users/grant-form";
import type { OnConflict } from "../users/grant-form";

// 收件地址页的「授权给用户」：选中的 M 个地址 × 选中的 N 个用户。表单规则与单用户授权（features/users/grant-form）同一口径，
// 这里只补多用户的请求体与逐条结果；过期时间解析、原因中文化直接复用。

export type MultiGrantValues = {
  userIds: readonly number[];
  mailboxIds: readonly number[];
  /** null = 完整访问；必须显式给，不让漏选悄悄变成完整访问 */
  ruleGroupId: number | null;
  expiresLocal: string;
  onConflict: OnConflict;
};

type Built = { ok: true; value: GrantBatchRequest } | { ok: false; error: string };

export function buildMultiGrantRequest(values: MultiGrantValues, nowSec: number): Built {
  if (values.userIds.length === 0) return { ok: false, error: "请至少选择一个用户" };
  if (values.userIds.length > GRANT_BATCH_MAX_USERS) return { ok: false, error: `一次最多选择 ${GRANT_BATCH_MAX_USERS} 个用户` };
  if (values.mailboxIds.length === 0) return { ok: false, error: "没有选中的收件地址" };
  if (values.mailboxIds.length > GRANT_BATCH_MAX_MAILBOXES) return { ok: false, error: `一次最多 ${GRANT_BATCH_MAX_MAILBOXES} 个收件地址` };
  const expires = parseExpiresLocal(values.expiresLocal, nowSec);
  if (!expires.ok) return expires;
  const body: GrantBatchRequest = {
    user_ids: [...values.userIds],
    mailbox_ids: [...values.mailboxIds],
    rule_group_id: values.ruleGroupId,
    expires_at: expires.value,
    on_conflict: values.onConflict,
  };
  const parsed = grantBatchRequestSchema.safeParse(body);
  return parsed.success ? { ok: true, value: body } : { ok: false, error: parsed.error.issues[0]?.message ?? "请求无效" };
}

export type ResultRow = { key: string; who: string; status: GrantBatchResponse["results"][number]["status"]; label: string; note: string };

const STATUS_LABEL: Record<ResultRow["status"], string> = { created: "已授权", updated: "已更新", skipped: "已跳过", failed: "失败" };

/** 逐条结果：用户 × 地址、状态、原因（中文）；找不到名字时显示 #id，不编造 */
export function describeGrantResults(
  response: GrantBatchResponse,
  users: ReadonlyMap<number, string>,
  mailboxes: ReadonlyMap<number, string>,
): ResultRow[] {
  return response.results.map((item) => ({
    key: `${item.user_id}:${item.mailbox_id}`,
    who: `${users.get(item.user_id) ?? `#${item.user_id}`} × ${mailboxes.get(item.mailbox_id) ?? `#${item.mailbox_id}`}`,
    status: item.status,
    label: STATUS_LABEL[item.status],
    note: item.reason === null ? "" : reasonLabel(item.reason),
  }));
}
