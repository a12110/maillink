import { ChevronLeft, ChevronRight, Copy, Eye, Link2, Link2Off, TriangleAlert } from "lucide-react";
import type { AdminShareLink } from "@maillink/shared";
import { formatDateTime } from "../../lib/format";
import { Button, EmptyState, ErrorCallout, SkeletonRows, Status, Tag } from "../../ui";
import { ANOMALY_HINT, ANOMALY_LABEL, ANOMALY_SHORT, STATE_LABEL, STATE_TONE, addressSummary, devicesText, linkTitle } from "./labels";

const SKELETON_ROWS = 8;
const COLUMN_COUNT = 10;

type RowActions = {
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
  onCopy: (link: AdminShareLink) => void;
  onPreview: (link: AdminShareLink) => void;
};

function Anomalies({ link }: { link: AdminShareLink }) {
  if (link.anomalies.length === 0) return null;
  return (
    <span className="cell-tags">
      {link.anomalies.map((anomaly) => (
        <span key={anomaly} title={`${ANOMALY_LABEL[anomaly]}：${ANOMALY_HINT[anomaly]}`}>
          <Tag tone="danger">
            <TriangleAlert className="tag-icon" aria-hidden="true" />
            <span aria-hidden="true">{ANOMALY_SHORT[anomaly]}</span>
            <span className="sr-only">{ANOMALY_LABEL[anomaly]}</span>
          </Tag>
        </span>
      ))}
    </span>
  );
}

function AddressCell({ link }: { link: AdminShareLink }) {
  const { first, more } = addressSummary(link);
  return (
    <td className="col-optional mono-cell" title={link.mailboxes.map((mailbox) => mailbox.address).join("\n")}>
      {first === null ? <span className="dim">—</span> : more > 0 ? `${first} 等 ${more + 1} 个` : first}
    </td>
  );
}

function TimeCell({ value, empty }: { value: number | null; empty: string }) {
  return <td className="time col-secondary">{value === null ? <span className="dim">{empty}</span> : formatDateTime(value)}</td>;
}

function LinkRow({ link, selected, checked, actions }: { link: AdminShareLink; selected: boolean; checked: boolean; actions: RowActions }) {
  const title = linkTitle(link);
  return (
    <tr data-selected={selected || checked} onClick={() => actions.onSelect(link.id)}>
      <td className="col-check" onClick={(event) => event.stopPropagation()}>
        <input type="checkbox" checked={checked} aria-label={`选择 ${title}`} onChange={() => actions.onToggle(link.id)} />
      </td>
      <td title={link.order_ref && link.name ? `${link.name}（${link.order_ref}）` : title}>
        <button type="button" className="row-link" data-link-id={link.id} aria-current={selected ? "true" : undefined} onClick={() => actions.onSelect(link.id)}>
          {title}
        </button>
        {link.name && link.order_ref ? <span className="dim"> {link.order_ref}</span> : null}
      </td>
      <AddressCell link={link} />
      <td className="col-optional" title={link.rule_group.name}>
        {link.rule_group.name}
      </td>
      <td>
        <span className="cell-status">
          <Status tone={STATE_TONE[link.state]}>{STATE_LABEL[link.state]}</Status>
          <Anomalies link={link} />
        </span>
      </td>
      <TimeCell value={link.effective_expires_at} empty="不过期" />
      <td className="col-optional col-num">{devicesText(link)}</td>
      <td className="col-optional col-num" title="近 24 小时取码数">
        {link.deliveries_24h}
      </td>
      <TimeCell value={link.last_access_at} empty="从未" />
      <td className="col-actions" onClick={(event) => event.stopPropagation()}>
        <span className="row-actions">
          <Button variant="ghost" size="sm" iconOnly aria-label={`复制 ${title} 的链接`} title="复制链接（会写审计）" onClick={() => actions.onCopy(link)}>
            <Copy />
          </Button>
          <Button variant="ghost" size="sm" iconOnly aria-label={`预览 ${title}`} title="预览访问者视角" onClick={() => actions.onPreview(link)}>
            <Eye />
          </Button>
        </span>
      </td>
    </tr>
  );
}

function TableHead({ allChecked, onToggleAll }: { allChecked: boolean; onToggleAll: () => void }) {
  return (
    <>
      <colgroup>
        <col data-w="check" />
        <col />
        <col className="col-optional" data-w="addr" />
        <col className="col-optional" data-w="group" />
        <col data-w="state" />
        <col className="col-secondary" data-w="sm" />
        <col className="col-optional" data-w="num" />
        <col className="col-optional" data-w="num" />
        <col className="col-secondary" data-w="time" />
        <col data-w="actions" />
      </colgroup>
      <thead>
        <tr>
          <th className="col-check">
            <input type="checkbox" checked={allChecked} aria-label="选择本页全部链接" onChange={onToggleAll} />
          </th>
          <th>名称 / 订单号</th>
          <th className="col-optional">收件地址</th>
          <th className="col-optional">规则组</th>
          <th>状态</th>
          <th className="col-secondary">过期时间</th>
          <th className="col-optional col-num">设备数</th>
          <th className="col-optional col-num">24h 取码</th>
          <th className="col-secondary">最近访问</th>
          <th>
            <span className="sr-only">操作</span>
          </th>
        </tr>
      </thead>
    </>
  );
}

type LinkTableProps = RowActions & {
  links: AdminShareLink[] | undefined;
  loading: boolean;
  error: { message: string; detail: string } | null;
  filtered: boolean;
  page: number;
  hasNext: boolean;
  selectedId: number | null;
  checked: ReadonlySet<number>;
  onToggleAll: () => void;
  onPage: (direction: -1 | 1) => void;
  onRetry: () => void;
  onClearFilters: () => void;
  onCreate: () => void;
};

function EmptyBody({ filtered, onClearFilters, onCreate }: Pick<LinkTableProps, "filtered" | "onClearFilters" | "onCreate">) {
  return filtered ? (
    <EmptyState icon={Link2Off} title="没有符合筛选的链接" description="换个关键词，或清除筛选再看看。" action={<Button onClick={onClearFilters}>清除筛选</Button>} />
  ) : (
    <EmptyState icon={Link2} title="还没有取件链接" description="选择收件地址与规则组，生成第一个取件链接。" action={<Button variant="primary" onClick={onCreate}>生成取件链接</Button>} />
  );
}

function Body(props: LinkTableProps) {
  const { links, error } = props;
  const errorBlock = error ? (
    <div className="card-pad">
      <ErrorCallout title="取件链接加载失败" {...error} onRetry={props.onRetry} />
    </div>
  ) : null;
  if (!links && error) return errorBlock;
  if (links && links.length === 0 && !error) return <EmptyBody {...props} />;
  const allChecked = links !== undefined && links.length > 0 && links.every((link) => props.checked.has(link.id));
  return (
    <>
      {errorBlock}
      <table className="table" aria-busy={props.loading}>
        <TableHead allChecked={allChecked} onToggleAll={props.onToggleAll} />
        <tbody>
          {links ? (
            links.map((link) => <LinkRow key={link.id} link={link} selected={link.id === props.selectedId} checked={props.checked.has(link.id)} actions={props} />)
          ) : (
            <SkeletonRows rows={SKELETON_ROWS} columns={COLUMN_COUNT} />
          )}
        </tbody>
      </table>
    </>
  );
}

export function LinkTable(props: LinkTableProps) {
  const { links, page, hasNext, onPage } = props;
  return (
    <div className="panel">
      <Body {...props} />
      <div className="table-foot">
        <span className="num">{links ? `第 ${page} 页 · 本页 ${links.length} 条` : "加载中…"}</span>
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
