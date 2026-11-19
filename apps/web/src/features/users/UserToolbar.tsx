import { Plus, Search } from "lucide-react";
import type { UserRole, UserStatus } from "@maillink/shared";
import { Button, Select } from "../../ui";
import { ROLE_LABEL, STATUS_LABEL, toRoleFilter, toStatusFilter } from "./labels";

export type UserFilters = { q: string; role: UserRole | ""; status: UserStatus | "" };

type UserToolbarProps = {
  filters: UserFilters;
  onChange: (filters: UserFilters) => void;
  onCreate: () => void;
};

/** 工具栏：搜索、角色与状态筛选、新建用户（一屏唯一的主按钮） */
export function UserToolbar({ filters, onChange, onCreate }: UserToolbarProps) {
  return (
    <div className="toolbar" role="search">
      <div className="search">
        <Search />
        <input
          className="input"
          type="search"
          placeholder="搜索用户名、显示名或邮箱"
          aria-label="搜索用户"
          value={filters.q}
          onChange={(event) => onChange({ ...filters, q: event.target.value })}
        />
      </div>
      <Select
        aria-label="角色筛选"
        value={filters.role}
        onChange={(event) => onChange({ ...filters, role: toRoleFilter(event.target.value) })}
      >
        <option value="">全部角色</option>
        <option value="admin">{ROLE_LABEL.admin}</option>
        <option value="user">{ROLE_LABEL.user}</option>
      </Select>
      <Select
        aria-label="状态筛选"
        value={filters.status}
        onChange={(event) => onChange({ ...filters, status: toStatusFilter(event.target.value) })}
      >
        <option value="">全部状态</option>
        <option value="active">{STATUS_LABEL.active}</option>
        <option value="disabled">{STATUS_LABEL.disabled}</option>
      </Select>
      <span className="spacer" />
      <Button variant="primary" onClick={onCreate}>
        <Plus />
        新建用户
      </Button>
    </div>
  );
}
