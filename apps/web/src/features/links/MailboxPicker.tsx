import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { mailboxPickerQuery } from "../../api/links-queries";
import { MAILBOX_PICKER_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "../../constants";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { describeError } from "../../lib/messages";
import { Button, ErrorCallout } from "../../ui";
import { useCursorStack } from "./useCursorStack";

export type PickedMailbox = { id: number; /** 来自“收件地址页”的预选只有 id，看不到地址 */ address: string | null };

type MailboxPickerProps = {
  value: readonly PickedMailbox[];
  onChange: (value: PickedMailbox[]) => void;
  /** 选择上限（换绑一个链接最多 50 个） */
  max?: number;
};

/** 收件地址多选：搜索 + 分页列表（只列启用的地址），可全选本页，已选项跨页保留 */
function PickerList({ items, loading, empty, selected, atMax, onToggle }: { items: readonly { id: number; address: string; note: string | null; link_count: number }[]; loading: boolean; empty: boolean; selected: ReadonlySet<number>; atMax: boolean; onToggle: (id: number, address: string) => void }) {
  return (
    <ul className="picker-list" aria-busy={loading}>
      {items.map((item) => (
        <li key={item.id}>
          <label>
            <input type="checkbox" checked={selected.has(item.id)} disabled={!selected.has(item.id) && atMax} onChange={() => onToggle(item.id, item.address)} />
            <span className="mono">{item.address}</span>
            {item.note ? <span className="dim">{item.note}</span> : null}
            {item.link_count > 0 ? <span className="dim num">已有 {item.link_count} 个链接</span> : null}
          </label>
        </li>
      ))}
      {empty ? <li className="picker-empty">没有符合的启用地址</li> : null}
    </ul>
  );
}

function usePickerData() {
  const [text, setText] = useState("");
  const q = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const [cursorKey, setCursorKey] = useState(q);
  const pages = useCursorStack();
  if (cursorKey !== q) {
    setCursorKey(q);
    pages.reset();
  }
  const list = useQuery(mailboxPickerQuery({ q: q || undefined, status: "active", limit: MAILBOX_PICKER_PAGE_SIZE, cursor: pages.cursor }));
  return { text, setText, pages, list };
}

type PickerItem = { id: number; address: string };

/** 已选项跨页保留；到上限后只能取消；“选择本页全部”不超过上限 */
function useSelection(value: readonly PickedMailbox[], onChange: (value: PickedMailbox[]) => void, items: readonly PickerItem[], max: number | undefined) {
  const selected = new Set(value.map((item) => item.id));
  const atMax = max !== undefined && value.length >= max;
  const toggle = (id: number, address: string) => {
    if (selected.has(id)) onChange(value.filter((item) => item.id !== id));
    else if (!atMax) onChange([...value, { id, address }]);
  };
  const addPage = () => {
    const room = max === undefined ? items.length : max - value.length;
    const extra = items.filter((item) => !selected.has(item.id)).slice(0, Math.max(0, room));
    onChange([...value, ...extra.map((item) => ({ id: item.id, address: item.address }))]);
  };
  return { selected, atMax, toggle, addPage };
}

function PickerCount({ count, max, onClear }: { count: number; max: number | undefined; onClear: () => void }) {
  return (
    <p className="picker-count num" role="status">
      已选 {count} 个{max === undefined ? "" : `（最多 ${max} 个）`}
      {count > 0 ? <button type="button" className="text-action" onClick={onClear}>清空</button> : null}
    </p>
  );
}

export function MailboxPicker({ value, onChange, max }: MailboxPickerProps) {
  const { text, setText, pages, list } = usePickerData();
  const items = list.data?.items ?? [];
  const { selected, atMax, toggle, addPage } = useSelection(value, onChange, items, max);
  const nextCursor = list.data?.next_cursor ?? null;

  return (
    <div className="picker">
      <div className="picker-bar">
        <div className="search">
          <Search />
          <input className="input" type="search" placeholder="搜索地址、名称或备注" aria-label="搜索收件地址" value={text} onChange={(event) => setText(event.target.value)} />
        </div>
        <Button size="sm" onClick={addPage} disabled={items.length === 0 || atMax}>选择本页全部</Button>
      </div>
      <PickerCount count={value.length} max={max} onClear={() => onChange([])} />
      {list.isError ? <ErrorCallout title="收件地址加载失败" {...describeError(list.error)} onRetry={() => void list.refetch()} /> : null}
      <PickerList items={items} loading={list.isFetching} empty={list.data !== undefined && items.length === 0} selected={selected} atMax={atMax} onToggle={toggle} />
      <div className="picker-foot">
        <span className="num">第 {pages.page} 页{list.data ? ` · 共 ${list.data.total} 个启用地址` : ""}</span>
        <div className="pager">
          <Button size="sm" iconOnly aria-label="上一页" disabled={pages.page <= 1} onClick={pages.back}><ChevronLeft /></Button>
          <Button size="sm" iconOnly aria-label="下一页" disabled={nextCursor === null} onClick={() => nextCursor !== null && pages.forward(nextCursor)}><ChevronRight /></Button>
        </div>
      </div>
    </div>
  );
}
