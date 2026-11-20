import { useQuery } from "@tanstack/react-query";
import { adminUsersQuery } from "../../api/queries";
import { Select } from "../../ui";
import { AUDIT_ACTION_LABEL } from "./labels";

export type AuditFilterDraft = { action: string; actor: string; since: string; until: string };
export const NO_AUDIT_FILTERS: AuditFilterDraft = { action: "", actor: "", since: "", until: "" };

const ACTOR_LIST_LIMIT = 100;
const ACTIONS_LIST_ID = "audit-actions";

type Props = { filters: AuditFilterDraft; rangeError: string | null; onChange: (filters: AuditFilterDraft) => void };

/** 筛选：动作（可输入任意动作名，候选是已知动作）、执行者（用户下拉）、时间范围（含边界） */
export function AuditFilters({ filters, rangeError, onChange }: Props) {
  const users = useQuery(adminUsersQuery({ limit: ACTOR_LIST_LIMIT }));
  const set = (patch: Partial<AuditFilterDraft>) => onChange({ ...filters, ...patch });
  return (
    <div className="toolbar audit-filters" role="search">
      <div className="audit-action">
        <input className="input" list={ACTIONS_LIST_ID} aria-label="动作" placeholder="动作，如 rule_group.update" data-mono="true" value={filters.action}
          onChange={(event) => set({ action: event.target.value })} />
        <datalist id={ACTIONS_LIST_ID}>
          {Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => <option key={value} value={value} label={label} />)}
        </datalist>
      </div>
      <Select aria-label="执行者" value={filters.actor} onChange={(event) => set({ actor: event.target.value })}>
        <option value="">全部执行者</option>
        {users.data?.items.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}
      </Select>
      <label className="audit-time">从<input className="input" type="datetime-local" aria-label="开始时间" value={filters.since} onChange={(event) => set({ since: event.target.value })} /></label>
      <label className="audit-time">到<input className="input" type="datetime-local" aria-label="结束时间" value={filters.until} onChange={(event) => set({ until: event.target.value })} /></label>
      {rangeError ? <span className="field-error">{rangeError}</span> : null}
    </div>
  );
}
