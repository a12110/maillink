import type { AuditLogListQuery } from "@maillink/shared";
import { localInputToUnix } from "../mails/search";
import type { AuditFilterDraft } from "./AuditFilters";

/** 筛选草稿 → 查询参数；时间范围倒置时给出原因，不发请求 */
export function toAuditQuery(filters: AuditFilterDraft): { query: Omit<AuditLogListQuery, "cursor" | "limit">; error: string | null } {
  const since = localInputToUnix(filters.since, "start");
  const until = localInputToUnix(filters.until, "end");
  const actor = filters.actor === "" ? undefined : Number(filters.actor);
  const action = filters.action.trim();
  if (since !== undefined && until !== undefined && since > until) {
    return { query: {}, error: "开始时间不能晚于结束时间" };
  }
  return { query: { action: action === "" ? undefined : action, actor_user_id: actor, since, until }, error: null };
}

export function hasAuditFilters(filters: AuditFilterDraft): boolean {
  return Object.values(filters).some((value) => value.trim() !== "");
}

/** 审计详情里有些字段是“JSON 文本”（如规则组更新前的 config）：能解析成对象 / 数组的展开显示，免得满屏转义引号。其余原样 */
export function expandJsonStrings(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return expandJsonStrings(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(expandJsonStrings);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expandJsonStrings(child)]));
  }
  return value;
}
