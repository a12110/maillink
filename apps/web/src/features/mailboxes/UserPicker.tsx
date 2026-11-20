import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminUser } from "@maillink/shared";
import { adminUsersQuery } from "../../api/queries";
import { SEARCH_DEBOUNCE_MS } from "../../constants";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { describeError } from "../../lib/messages";
import { Button, ErrorCallout, TextField } from "../../ui";

/** 已选用户：id → 用户名（跨搜索保留） */
export type PickedUsers = ReadonlyMap<number, string>;

const PICKER_LIMIT = 50;

type Props = { picked: PickedUsers; onChange: (next: PickedUsers) => void };

function toggle(picked: PickedUsers, user: AdminUser): PickedUsers {
  const next = new Map(picked);
  if (next.has(user.id)) next.delete(user.id);
  else next.set(user.id, user.username);
  return next;
}

/** 用户多选：搜索用户名 / 显示名 / 邮箱，只列启用中的普通用户（停用用户登录不了；后端拒绝给管理员授权） */
export function UserPicker({ picked, onChange }: Props) {
  const [text, setText] = useState("");
  const q = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const list = useQuery(adminUsersQuery({ q: q === "" ? undefined : q, role: "user", status: "active", limit: PICKER_LIMIT }));
  const items = list.data?.items ?? [];
  return (
    <div className="dialog-form">
      <TextField label="用户" type="search" placeholder="搜索用户名、显示名或邮箱" value={text} hint={`已选 ${picked.size} 个；只列出启用中的普通用户（管理员不需要授权）`} onChange={(event) => setText(event.target.value)} />
      {list.isError ? <ErrorCallout title="用户加载失败" {...describeError(list.error)} onRetry={() => void list.refetch()} /> : null}
      {list.data ? (
        <ul className="picker-list" aria-label="用户列表">
          {items.length === 0 ? <li className="picker-item dim">没有符合条件的用户</li> : null}
          {items.map((user) => (
            <li key={user.id}>
              <label className="picker-item">
                <input type="checkbox" checked={picked.has(user.id)} onChange={() => onChange(toggle(picked, user))} />
                <span>{user.username}</span>
                {user.display_name ? <span className="dim">{user.display_name}</span> : null}
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {list.data?.next_cursor != null ? <p className="field-hint">只显示前 {items.length} 个，请输入关键词缩小范围。</p> : null}
      <div className="form-actions">
        <Button size="sm" variant="ghost" disabled={picked.size === 0} onClick={() => onChange(new Map())}>清空已选</Button>
      </div>
    </div>
  );
}
