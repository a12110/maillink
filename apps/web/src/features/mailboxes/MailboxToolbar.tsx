import { Link2, Power, PowerOff, Search, Tag, Tags, Trash2, Upload, UserPlus, X } from "lucide-react";
import type { MailboxStatus } from "@maillink/shared";
import { Button, Select } from "../../ui";
import { STATUS_LABEL } from "./labels";
import type { MailboxFilters } from "./useMailboxList";

const TAG_LIST_ID = "mailbox-known-tags";

function toStatus(value: string): MailboxStatus | "" {
  if (value === "active" || value === "disabled") return value;
  return "";
}

type ToolbarProps = {
  filters: MailboxFilters;
  knownTags: readonly string[];
  tagError: string | null;
  onChange: (filters: MailboxFilters) => void;
  onImport: () => void;
};

/** 默认工具栏：搜索、标签筛选、状态筛选、导入（一屏唯一的主按钮）。选中行后被批量条替换 */
export function MailboxToolbar({ filters, knownTags, tagError, onChange, onImport }: ToolbarProps) {
  return (
    <div className="toolbar" role="search">
      <div className="search">
        <Search />
        <input
          className="input"
          type="search"
          placeholder="搜索地址、名称或备注"
          aria-label="搜索地址、名称或备注"
          value={filters.q}
          onChange={(event) => onChange({ ...filters, q: event.target.value })}
        />
      </div>
      <div className="tag-filter">
        <input
          className="input"
          list={TAG_LIST_ID}
          placeholder="按标签筛选"
          aria-label="标签筛选"
          aria-invalid={tagError ? "true" : undefined}
          title={tagError ?? "输入标签名；候选来自已加载的地址"}
          value={filters.tag}
          onChange={(event) => onChange({ ...filters, tag: event.target.value })}
        />
        <datalist id={TAG_LIST_ID}>
          {knownTags.map((tag) => <option key={tag} value={tag} />)}
        </datalist>
      </div>
      <Select aria-label="状态筛选" value={filters.status} onChange={(event) => onChange({ ...filters, status: toStatus(event.target.value) })}>
        <option value="">全部状态</option>
        <option value="active">{STATUS_LABEL.active}</option>
        <option value="disabled">{STATUS_LABEL.disabled}</option>
      </Select>
      {tagError ? <span className="field-error">{tagError}</span> : null}
      <span className="spacer" />
      <Button variant="primary" onClick={onImport}>
        <Upload />
        导入
      </Button>
    </div>
  );
}

type BatchBarProps = {
  count: number;
  total: number | null;
  /** 选择全部会超过后端批量上限 */
  tooMany: boolean;
  allSelected: boolean;
  walking: boolean;
  busy: boolean;
  onSelectAll: () => void;
  /** 生成取件链接：带着选中的地址去链接页的创建对话框 */
  onCreateLinks: () => void;
  /** 授权给用户：选中的地址 × 选中的用户 */
  onGrant: () => void;
  onTag: (mode: "add" | "remove") => void;
  onSetStatus: (status: MailboxStatus) => void;
  onDelete: () => void;
  onClear: () => void;
  limit: number;
};

function SelectAllControl(props: BatchBarProps) {
  if (props.total === null || props.allSelected) return null;
  if (props.tooMany) {
    return <span className="field-hint">筛选结果共 {props.total} 个，超过批量上限 {props.limit}，请缩小筛选后再全选</span>;
  }
  return (
    <button type="button" className="link-action" disabled={props.walking} onClick={props.onSelectAll}>
      {props.walking ? "正在选择…" : `选择全部 ${props.total} 项`}
    </button>
  );
}

/** 批量条：与默认工具栏等高、同一位置互换；「生成取件链接」接替「导入」成为主按钮；次操作含「授权给用户」 */
export function MailboxBatchBar(props: BatchBarProps) {
  const { count, busy } = props;
  return (
    <div className="batch-bar" role="toolbar" aria-label="批量操作">
      <span className="count">已选 <b>{count}</b> 项</span>
      <SelectAllControl {...props} />
      <span className="sep" />
      <Button size="sm" variant="primary" disabled={busy} onClick={props.onCreateLinks}><Link2 />生成取件链接</Button>
      <Button size="sm" disabled={busy} onClick={props.onGrant}><UserPlus />授权给用户</Button>
      <Button size="sm" disabled={busy} onClick={() => props.onTag("add")}><Tag />打标签</Button>
      <Button size="sm" disabled={busy} onClick={() => props.onTag("remove")}><Tags />去标签</Button>
      <Button size="sm" disabled={busy} onClick={() => props.onSetStatus("active")}><Power />启用</Button>
      <Button size="sm" disabled={busy} onClick={() => props.onSetStatus("disabled")}><PowerOff />停用</Button>
      <span className="spacer" />
      <Button size="sm" variant="danger-ghost" disabled={busy} onClick={props.onDelete}><Trash2 />删除</Button>
      <Button size="sm" variant="ghost" onClick={props.onClear}><X />取消选择</Button>
    </div>
  );
}
