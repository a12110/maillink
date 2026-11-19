import { useEffect, useId, useRef, useState } from "react";
import { MAIL_SCOPES } from "@maillink/shared";
import { SEARCH_DEBOUNCE_MS } from "../../constants";
import { Select, TextField } from "../../ui";
import { applyDraft, draftKey, draftOf, SCOPE_LABEL } from "./search";
import type { FilterDraft, MailFilters } from "./search";

type MailFilterBarProps = {
  filters: MailFilters;
  onChange: (filters: MailFilters) => void;
};

type TextFieldName = "to_address" | "address" | "source";

/**
 * 草稿与 URL 的双向同步：
 * - 文本输入停顿后（或按 Enter）写入 URL，时间与范围立即写入；
 * - URL 因后退 / 外部链接变化时，把新值同步回输入框；自己刚写入的那次变化不回灌，免得吞掉还在输入的字。
 */
function useFilterDraft(filters: MailFilters, onChange: (filters: MailFilters) => void) {
  const urlKey = draftKey(draftOf(filters));
  const [draft, setDraft] = useState<FilterDraft>(() => draftOf(filters));
  const [sync, setSync] = useState({ url: urlKey, committed: urlKey });
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ filters, onChange });
  const timer = useRef<number | null>(null);

  useEffect(() => {
    latest.current = { filters, onChange };
  });
  useEffect(() => () => clearTimer(timer), []);

  if (sync.url !== urlKey) {
    setSync({ url: urlKey, committed: urlKey });
    if (urlKey !== sync.committed) {
      setDraft(draftOf(filters));
      setError(null);
    }
  }

  const commit = (next: FilterDraft, patch: Partial<MailFilters> = {}) => {
    clearTimer(timer);
    const result = applyDraft(next, { ...latest.current.filters, ...patch });
    if (!result.ok) return setError(result.error);
    setError(null);
    setSync((current) => ({ ...current, committed: draftKey(draftOf(result.filters)) }));
    latest.current.onChange(result.filters);
  };
  const edit = (patch: Partial<FilterDraft>, immediate: boolean) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    clearTimer(timer);
    if (immediate) commit(next);
    else timer.current = window.setTimeout(() => commit(next), SEARCH_DEBOUNCE_MS);
  };
  return { draft, error, edit, commit };
}

function clearTimer(timer: { current: number | null }) {
  if (timer.current !== null) window.clearTimeout(timer.current);
  timer.current = null;
}

export function MailFilterBar({ filters, onChange }: MailFilterBarProps) {
  const { draft, error, edit, commit } = useFilterDraft(filters, onChange);
  const scopeId = useId();
  const textField = (name: TextFieldName, label: string, hint: string) => (
    <TextField
      label={label}
      mono
      type="search"
      placeholder={hint}
      value={draft[name]}
      onChange={(event) => edit({ [name]: event.target.value }, false)}
      onKeyDown={(event) => event.key === "Enter" && commit(draft)}
    />
  );
  return (
    <form className="mail-filters" role="search" aria-label="筛选邮件" onSubmit={(event) => event.preventDefault()}>
      {textField("to_address", "收件地址", "邮件头收件人")}
      {textField("address", "信封地址", "信封收件人")}
      {textField("source", "信封发件人", "不区分大小写")}
      <TextField label="开始时间" type="datetime-local" value={draft.since} onChange={(e) => edit({ since: e.target.value }, true)} />
      <TextField
        label="结束时间"
        type="datetime-local"
        value={draft.until}
        error={error ?? undefined}
        onChange={(e) => edit({ until: e.target.value }, true)}
      />
      <div className="field">
        <label className="field-label" htmlFor={scopeId}>
          范围
        </label>
        <Select
          id={scopeId}
          block
          value={filters.scope ?? "all"}
          onChange={(event) => commit(draft, { scope: MAIL_SCOPES.find((s) => s === event.target.value) })}
        >
          {MAIL_SCOPES.map((scope) => (
            <option key={scope} value={scope}>
              {SCOPE_LABEL[scope]}
            </option>
          ))}
        </Select>
      </div>
    </form>
  );
}
