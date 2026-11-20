import { grantBatchRequestSchema, GRANT_BATCH_MAX_MAILBOXES } from "@maillink/shared";
import type { AdminGrant, GrantBatchRequest, GrantBatchResponse, GrantPatch } from "@maillink/shared";
import { MS_PER_SECOND } from "../../constants";

export type OnConflict = "skip" | "update";

export type GrantFormValues = {
  mailboxIds: readonly number[];
  /** null = 完整访问（黑名单、无规则、full 视图） */
  ruleGroupId: number | null;
  /** `<input type="datetime-local">` 的值（本地时间，如 2026-12-01T10:30）；空串 = 不过期 */
  expiresLocal: string;
  onConflict: OnConflict;
};

type Built<T> = { ok: true; value: T } | { ok: false; error: string };

/** datetime-local（本地时间）→ Unix 秒。空串 = null（不过期）；无法解析或不在未来 → 错误（后端也会拒绝过去的时间） */
export function parseExpiresLocal(value: string, nowSec: number): Built<number | null> {
  if (value === "") return { ok: true, value: null };
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return { ok: false, error: "过期时间格式不对" };
  const seconds = Math.floor(ms / MS_PER_SECOND);
  if (seconds <= nowSec) return { ok: false, error: "过期时间必须晚于现在；要立刻收回授权请直接删除" };
  return { ok: true, value: seconds };
}

/** Unix 秒 → datetime-local 的值（本地时间，精确到分钟）；null → 空串 */
export function toDatetimeLocal(unixSec: number | null): string {
  if (unixSec === null) return "";
  const d = new Date(unixSec * MS_PER_SECOND);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 批量授权请求体：`rule_group_id` 必须显式给（null 才是完整访问），不让漏选悄悄变成完整访问 */
export function buildBatchRequest(userId: number, values: GrantFormValues, nowSec: number): Built<GrantBatchRequest> {
  if (values.mailboxIds.length === 0) return { ok: false, error: "请至少选择一个收件地址" };
  if (values.mailboxIds.length > GRANT_BATCH_MAX_MAILBOXES) return { ok: false, error: `一次最多选择 ${GRANT_BATCH_MAX_MAILBOXES} 个收件地址` };
  const expires = parseExpiresLocal(values.expiresLocal, nowSec);
  if (!expires.ok) return expires;
  const body: GrantBatchRequest = {
    user_ids: [userId],
    mailbox_ids: [...values.mailboxIds],
    rule_group_id: values.ruleGroupId,
    expires_at: expires.value,
    on_conflict: values.onConflict,
  };
  const parsed = grantBatchRequestSchema.safeParse(body);
  return parsed.success ? { ok: true, value: body } : { ok: false, error: parsed.error.issues[0]?.message ?? "请求无效" };
}

/** 编辑授权：只提交改过的字段（后端 PATCH 至少要有一个字段） */
export function buildGrantPatch(grant: AdminGrant, values: Pick<GrantFormValues, "ruleGroupId" | "expiresLocal">, nowSec: number): Built<GrantPatch> {
  const expires = parseExpiresLocal(values.expiresLocal, nowSec);
  if (!expires.ok) return expires;
  const patch: GrantPatch = {};
  if (values.ruleGroupId !== grant.rule_group_id) patch.rule_group_id = values.ruleGroupId;
  // 过期时间只比较到分钟（输入框精度），没改就不提交，避免把"已过期"的旧值误判成要修改
  if (values.expiresLocal !== toDatetimeLocal(grant.expires_at)) patch.expires_at = expires.value;
  if (Object.keys(patch).length === 0) return { ok: false, error: "没有改动" };
  return { ok: true, value: patch };
}

export type GrantStatus = { tone: "success" | "warning" | "danger"; label: string };

/** 授权的当前状态：有效 / 已过期 / 地址已停用（`effective` 以后端为准） */
export function grantStatus(grant: AdminGrant): GrantStatus {
  if (grant.effective) return { tone: "success", label: "有效" };
  if (grant.expired) return { tone: "danger", label: "已过期" };
  if (grant.mailbox_status === "disabled") return { tone: "warning", label: "地址已停用" };
  return { tone: "warning", label: "未生效" };
}

const REASON_LABEL: Record<NonNullable<GrantBatchResponse["results"][number]["reason"]>, string> = {
  already_exists: "已有授权，按“跳过”保持不动",
  unchanged: "已有授权，内容相同",
  user_not_found: "用户不存在",
  mailbox_not_found: "收件地址不存在",
  grant_not_found: "要更新的授权刚被别人删除",
};

export function reasonLabel(reason: NonNullable<GrantBatchResponse["results"][number]["reason"]>): string {
  return REASON_LABEL[reason];
}

export function summarizeBatch(summary: GrantBatchResponse["summary"]): string {
  const parts = [`新增 ${summary.created}`, `更新 ${summary.updated}`, `跳过 ${summary.skipped}`];
  if (summary.failed > 0) parts.push(`失败 ${summary.failed}`);
  return parts.join("，");
}
