import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminMailbox } from "@maillink/shared";
import { mailboxPickerQuery } from "../../api/queries-auth";
import { SEARCH_DEBOUNCE_MS } from "../../constants";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { describeError } from "../../lib/messages";
import { Button, ErrorCallout, TextField } from "../../ui";

/** 已选收件地址：id → 地址（跨搜索保留，换关键词不丢已选项） */
export type PickedMailboxes = ReadonlyMap<number, string>;

type Props = { picked: PickedMailboxes; onChange: (next: PickedMailboxes) => void };

function toggle(picked: PickedMailboxes, mailbox: AdminMailbox): PickedMailboxes {
  const next = new Map(picked);
  if (next.has(mailbox.id)) next.delete(mailbox.id);
  else next.set(mailbox.id, mailbox.address);
  return next;
}

function addAll(picked: PickedMailboxes, items: AdminMailbox[]): PickedMailboxes {
  const next = new Map(picked);
  for (const mailbox of items) next.set(mailbox.id, mailbox.address);
  return next;
}

export function MailboxPicker({ picked, onChange }: Props) {
  const [text, setText] = useState("");
  const q = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const list = useQuery(mailboxPickerQuery(q));
  const items = list.data?.items ?? [];
  const truncated = list.data !== undefined && list.data.next_cursor !== null;

  return (
    <div className="dialog-form">
      <TextField label="收件地址" type="search" placeholder="搜索地址、名称、备注" value={text}
        hint={`已选 ${picked.size} 个；只列出启用中的地址`} onChange={(event) => setText(event.target.value)} />
      {list.isError ? <ErrorCallout title="收件地址加载失败" {...describeError(list.error)} onRetry={() => void list.refetch()} /> : null}
      {list.data ? (
        <ul className="picker-list" aria-label="收件地址列表">
          {items.length === 0 ? <li className="picker-item dim">没有符合条件的收件地址</li> : null}
          {items.map((mailbox) => (
            <li key={mailbox.id}>
              <label className="picker-item">
                <input type="checkbox" checked={picked.has(mailbox.id)} onChange={() => onChange(toggle(picked, mailbox))} />
                <span className="mono">{mailbox.address}</span>
                {mailbox.label ? <span className="dim">{mailbox.label}</span> : null}
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {truncated ? <p className="field-hint">只显示前 {items.length} 个，请输入关键词缩小范围。</p> : null}
      <div className="form-actions">
        <Button size="sm" disabled={items.length === 0} onClick={() => onChange(addAll(picked, items))}>选中当前列出的全部</Button>
        <Button size="sm" variant="ghost" disabled={picked.size === 0} onClick={() => onChange(new Map())}>清空已选</Button>
      </div>
    </div>
  );
}
