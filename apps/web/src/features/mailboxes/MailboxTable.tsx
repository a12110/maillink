import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Inbox, MailX, Pencil } from "lucide-react";
import type { AdminMailbox } from "@maillink/shared";
import { formatDateTime } from "../../lib/format";
import { Button, Checkbox, EmptyState, ErrorCallout, SkeletonRows, Status, Tag } from "../../ui";
import { STATUS_LABEL } from "./labels";
import type { Selection } from "./useMailboxSelection";

const SKELETON_ROWS = 8;
const COLUMN_COUNT = 9;
const MAX_TAGS_SHOWN = 3;
const LINKS_PENDING_NOTE = "取件链接页将在下一阶段提供，届时这里可点击查看";

/** 窄屏折行时优先在 @ 之前断开（DESIGN：折行点放在 @ 之前） */
function Address({ value }: { value: string }) {
  const at = value.lastIndexOf("@");
  if (at <= 0) return <>{value}</>;
  return (
    <>
      {value.slice(0, at)}
      <wbr />
      {value.slice(at)}
    </>
  );
}

function TagCell({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return <span className="dim">—</span>;
  return (
    <span className="cell-tags" title={tags.join("、")}>
      {tags.slice(0, MAX_TAGS_SHOWN).map((tag) => <Tag key={tag}>{tag}</Tag>)}
      {tags.length > MAX_TAGS_SHOWN ? <Tag>+{tags.length - MAX_TAGS_SHOWN}</Tag> : null}
    </span>
  );
}

function NoteCell({ mailbox }: { mailbox: AdminMailbox }) {
  const text = [mailbox.label, mailbox.note].filter((part): part is string => part !== null && part !== "").join(" · ");
  return text === "" ? <span className="dim">—</span> : <>{text}</>;
}

function CountCell({ value }: { value: number }) {
  return <span className={value === 0 ? "dim" : undefined} title={value === 0 ? undefined : LINKS_PENDING_NOTE}>{value}</span>;
}

type RowProps = { mailbox: AdminMailbox; checked: boolean; onToggle: (checked: boolean) => void; onEdit: () => void };

function MailboxRow({ mailbox, checked, onToggle, onEdit }: RowProps) {
  const { address } = mailbox;
  return (
    <tr data-selected={checked}>
      <td className="col-check">
        <Checkbox aria-label={`选择 ${address}`} checked={checked} onChange={(event) => onToggle(event.target.checked)} />
      </td>
      <td className="addr" title={address}><Address value={address} /></td>
      <td className="col-optional" title={mailbox.note ?? undefined}><NoteCell mailbox={mailbox} /></td>
      <td className="col-optional"><TagCell tags={mailbox.tags} /></td>
      <td>
        {mailbox.status === "active" ? <Status tone="success">{STATUS_LABEL.active}</Status> : <Status tone="neutral">{STATUS_LABEL.disabled}</Status>}
      </td>
      <td className="col-optional col-num"><CountCell value={mailbox.link_count} /></td>
      <td className="col-optional col-num"><CountCell value={mailbox.grant_count} /></td>
      <td className="time col-secondary">
        {mailbox.last_received_at === null ? <span className="dim">从未来信</span> : formatDateTime(mailbox.last_received_at)}
      </td>
      <td className="col-actions">
        <div className="row-actions" role="group" aria-label={`${address} 的操作`}>
          <Link className="btn" data-variant="ghost" data-size="sm" data-icon="true" to="/admin/mails" search={{ to_address: address }}
            title="该地址的邮件" aria-label={`查看 ${address} 的邮件`}>
            <Inbox />
          </Link>
          <Button variant="ghost" size="sm" iconOnly title="编辑备注、标签与状态" aria-label={`编辑 ${address}`} onClick={onEdit}>
            <Pencil />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function TableHead({ allChecked, someChecked, onToggleAll }: { allChecked: boolean; someChecked: boolean; onToggleAll: (checked: boolean) => void }) {
  return (
    <>
      <colgroup>
        <col data-w="check" />
        <col className="col-addr" />
        <col className="col-optional" />
        <col className="col-optional col-tags" />
        <col data-w="sm" />
        <col className="col-optional" data-w="xs" />
        <col className="col-optional" data-w="sm" />
        <col className="col-secondary" data-w="md" />
        <col data-w="actions" />
      </colgroup>
      <thead>
        <tr>
          <th className="col-check">
            <Checkbox
              aria-label="选择当前页全部"
              checked={allChecked}
              ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
              onChange={(event) => onToggleAll(event.target.checked)}
            />
          </th>
          <th>地址</th>
          <th className="col-optional">备注</th>
          <th className="col-optional">标签</th>
          <th>状态</th>
          <th className="col-optional col-num">链接数</th>
          <th className="col-optional col-num">授权用户数</th>
          <th className="col-secondary">最近来信</th>
          <th className="col-actions"><span className="sr-only">操作</span></th>
        </tr>
      </thead>
    </>
  );
}

type TableProps = {
  items: AdminMailbox[] | undefined;
  total: number | undefined;
  loading: boolean;
  error: { message: string; detail: string } | null;
  filtered: boolean;
  page: number;
  pageSize: number;
  hasNext: boolean;
  selection: Selection;
  onEdit: (mailbox: AdminMailbox) => void;
  onPage: (direction: -1 | 1) => void;
  onRetry: () => void;
  onClearFilters: () => void;
  onImport: () => void;
};

function EmptyBody({ filtered, onClearFilters, onImport }: Pick<TableProps, "filtered" | "onClearFilters" | "onImport">) {
  return filtered ? (
    <EmptyState icon={MailX} title="没有符合筛选的地址" description="换个关键词，或清除筛选再看看。" action={<Button onClick={onClearFilters}>清除筛选</Button>} />
  ) : (
    <EmptyState icon={Inbox} title="还没有收件地址" description="导入你的 iCloud 隐藏邮箱别名后，才能为它们生成取件链接。" action={<Button onClick={onImport}>导入地址</Button>} />
  );
}

function Rows({ items, selection, onEdit }: Pick<TableProps, "items" | "selection" | "onEdit">) {
  if (!items) return <SkeletonRows rows={SKELETON_ROWS} columns={COLUMN_COUNT} />;
  return (
    <>
      {items.map((mailbox) => (
        <MailboxRow
          key={mailbox.id}
          mailbox={mailbox}
          checked={selection.selected.has(mailbox.id)}
          onToggle={(checked) => selection.toggle(mailbox, checked)}
          onEdit={() => onEdit(mailbox)}
        />
      ))}
    </>
  );
}

function ErrorBlock({ error, onRetry }: { error: TableProps["error"]; onRetry: () => void }) {
  if (!error) return null;
  return (
    <div className="card-pad">
      <ErrorCallout title="收件地址加载失败" {...error} onRetry={onRetry} />
    </div>
  );
}

function TableBody(props: TableProps) {
  const { items, error, selection } = props;
  // 出错时保留已有数据（切换筛选 / 翻页失败），错误提示放在表上方，不吞
  if (!items && error) return <ErrorBlock error={error} onRetry={props.onRetry} />;
  if (items?.length === 0 && !error) return <EmptyBody {...props} />;
  const pageChecked = items?.filter((m) => selection.selected.has(m.id)).length ?? 0;
  return (
    <>
      <ErrorBlock error={error} onRetry={props.onRetry} />
      <table className="table mailbox-table" aria-busy={props.loading}>
        <TableHead
          allChecked={items !== undefined && pageChecked === items.length && pageChecked > 0}
          someChecked={pageChecked > 0}
          onToggleAll={(checked) => items && selection.setMany(items, checked)}
        />
        <tbody><Rows items={items} selection={selection} onEdit={props.onEdit} /></tbody>
      </table>
    </>
  );
}

function rangeText(props: TableProps): string {
  const { items, page, pageSize, total } = props;
  if (!items || total === undefined) return "加载中…";
  if (items.length === 0) return "没有地址";
  const from = (page - 1) * pageSize + 1;
  return `第 ${from}–${from + items.length - 1} 行，共 ${total} 行`;
}

export function MailboxTable(props: TableProps) {
  return (
    <div className="panel">
      <TableBody {...props} />
      <div className="table-foot">
        <span className="num">{rangeText(props)}</span>
        <div className="pager">
          <Button size="sm" iconOnly aria-label="上一页" disabled={props.page <= 1} onClick={() => props.onPage(-1)}><ChevronLeft /></Button>
          <Button size="sm" iconOnly aria-label="下一页" disabled={!props.hasNext} onClick={() => props.onPage(1)}><ChevronRight /></Button>
        </div>
      </div>
    </div>
  );
}
