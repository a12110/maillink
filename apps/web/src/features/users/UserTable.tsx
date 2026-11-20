import { ChevronLeft, ChevronRight, UserRoundX, Users } from "lucide-react";
import type { AdminUser } from "@maillink/shared";
import { formatDateTime } from "../../lib/format";
import { Button, EmptyState, ErrorCallout, SkeletonRows, Status, Tag } from "../../ui";
import { loginMethodLabels, ROLE_LABEL } from "./labels";

const SKELETON_ROWS = 8;
const COLUMN_COUNT = 7;

function UserRow({ user, selected, onSelect }: { user: AdminUser; selected: boolean; onSelect: (id: number) => void }) {
  const methods = loginMethodLabels(user.login_methods);
  return (
    <tr data-selected={selected} onClick={() => onSelect(user.id)}>
      <td title={user.display_name ? `${user.username}（${user.display_name}）` : user.username}>
        <button type="button" className="row-link" data-user-id={user.id} aria-current={selected ? "true" : undefined} onClick={() => onSelect(user.id)}>
          {user.username}
        </button>
        {user.display_name ? <span className="dim"> {user.display_name}</span> : null}
      </td>
      <td className="col-optional mono-cell" title={user.email ?? undefined}>
        {user.email ?? <span className="dim">—</span>}
      </td>
      <td>{user.role === "admin" ? <Tag>{ROLE_LABEL.admin}</Tag> : <span className="dim">{ROLE_LABEL.user}</span>}</td>
      <td>
        {user.status === "active" ? <Status tone="success">启用</Status> : <Status tone="neutral">已停用</Status>}
      </td>
      <td className="col-optional">
        {methods.length > 0 ? (
          <span className="cell-tags">{methods.map((label) => <Tag key={label}>{label}</Tag>)}</span>
        ) : (
          <span className="dim">—</span>
        )}
      </td>
      <td className="col-optional col-num">{user.mailbox_grant_count}</td>
      <td className="time col-secondary">{formatDateTime(user.last_login_at)}</td>
    </tr>
  );
}

function TableHead() {
  return (
    <>
      <colgroup>
        <col />
        <col className="col-optional" data-w="xl" />
        <col data-w="sm" />
        <col data-w="sm" />
        <col className="col-optional" data-w="xl" />
        <col className="col-optional" data-w="sm" />
        <col className="col-secondary" data-w="lg" />
      </colgroup>
      <thead>
        <tr>
          <th>用户名</th>
          <th className="col-optional">邮箱</th>
          <th>角色</th>
          <th>状态</th>
          <th className="col-optional">登录方式</th>
          <th className="col-optional col-num">授权邮箱数</th>
          <th className="col-secondary">最近登录</th>
        </tr>
      </thead>
    </>
  );
}

type UserTableProps = {
  users: AdminUser[] | undefined;
  loading: boolean;
  error: { message: string; detail: string } | null;
  filtered: boolean;
  page: number;
  hasNext: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onPage: (direction: -1 | 1) => void;
  onRetry: () => void;
  onClearFilters: () => void;
};

function EmptyBody({ filtered, onClearFilters }: { filtered: boolean; onClearFilters: () => void }) {
  return filtered ? (
    <EmptyState icon={UserRoundX} title="没有符合筛选的用户" description="换个关键词，或清除筛选再看看。"
      action={<Button onClick={onClearFilters}>清除筛选</Button>} />
  ) : (
    <EmptyState icon={Users} title="还没有用户" description="点击右上角的“新建用户”添加第一个用户。" />
  );
}

function Body(props: UserTableProps) {
  const { users, error } = props;
  // 出错时保留已有数据（切换筛选 / 翻页失败），错误提示放在表上方，不吞
  const errorBlock = error ? (
    <div className="card-pad">
      <ErrorCallout title="用户列表加载失败" {...error} onRetry={props.onRetry} />
    </div>
  ) : null;
  if (!users && error) return errorBlock;
  if (users && users.length === 0 && !error) return <EmptyBody filtered={props.filtered} onClearFilters={props.onClearFilters} />;
  return (
    <>
      {errorBlock}
      <table className="table" aria-busy={props.loading}>
        <TableHead />
        <tbody>
          {users ? (
            users.map((user) => (
              <UserRow key={user.id} user={user} selected={user.id === props.selectedId} onSelect={props.onSelect} />
            ))
          ) : (
            <SkeletonRows rows={SKELETON_ROWS} columns={COLUMN_COUNT} />
          )}
        </tbody>
      </table>
    </>
  );
}

export function UserTable(props: UserTableProps) {
  const { users, page, hasNext, onPage } = props;
  return (
    <div className="panel">
      <Body {...props} />
      <div className="table-foot">
        <span className="num">{users ? `第 ${page} 页 · 本页 ${users.length} 个用户` : "加载中…"}</span>
        <div className="pager">
          <Button size="sm" iconOnly aria-label="上一页" disabled={page <= 1} onClick={() => onPage(-1)}>
            <ChevronLeft />
          </Button>
          <Button size="sm" iconOnly aria-label="下一页" disabled={!hasNext} onClick={() => onPage(1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
