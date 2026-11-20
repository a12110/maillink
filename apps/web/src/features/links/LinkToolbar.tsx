import { useQuery } from "@tanstack/react-query";
import { Ban, CalendarPlus, Download, Pause, Play, Plus, Replace, Search, X } from "lucide-react";
import { SHARE_LINK_STATES } from "@maillink/shared";
import type { ShareLinkState } from "@maillink/shared";
import { linkRuleGroupChoicesQuery } from "../../api/links-queries";
import { Button, Select, Tag } from "../../ui";
import { STATE_LABEL } from "./labels";
import type { LinkFilters } from "./search";

type ToolbarProps = {
  filters: LinkFilters;
  onChange: (filters: LinkFilters) => void;
  onCreate: () => void;
};

function toState(value: string): ShareLinkState | "" {
  return SHARE_LINK_STATES.find((state) => state === value) ?? "";
}

/** 工具栏：关键词、状态、规则组、订单号筛选；生成取件链接（一屏唯一的主按钮） */
export function LinkToolbar({ filters, onChange, onCreate }: ToolbarProps) {
  const ruleGroups = useQuery(linkRuleGroupChoicesQuery());
  return (
    <div className="toolbar" role="search">
      <div className="search link-search">
        <Search />
        <input
          className="input"
          type="search"
          placeholder="搜索链接…"
          aria-label="搜索名称、订单号或收件地址"
          title="搜索名称、订单号或收件地址"
          value={filters.q}
          onChange={(event) => onChange({ ...filters, q: event.target.value })}
        />
      </div>
      <span className="link-select">
      <Select aria-label="状态筛选" value={filters.state} onChange={(event) => onChange({ ...filters, state: toState(event.target.value) })}>
        <option value="">全部状态</option>
        {SHARE_LINK_STATES.map((state) => (
          <option key={state} value={state}>
            {STATE_LABEL[state]}
          </option>
        ))}
      </Select>
      </span>
      <span className="link-select">
      <Select
        aria-label="规则组筛选"
        value={filters.ruleGroupId === null ? "" : String(filters.ruleGroupId)}
        onChange={(event) => onChange({ ...filters, ruleGroupId: event.target.value === "" ? null : Number(event.target.value) })}
      >
        <option value="">全部规则组</option>
        {ruleGroups.data?.items.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
        {filters.ruleGroupId !== null && !ruleGroups.data?.items.some((group) => group.id === filters.ruleGroupId) ? (
          <option value={filters.ruleGroupId}>规则组 #{filters.ruleGroupId}</option>
        ) : null}
      </Select>
      </span>
      <div className="search link-order-filter">
        <input
          className="input"
          type="search"
          placeholder="订单号"
          aria-label="按订单号筛选"
          value={filters.orderRef}
          onChange={(event) => onChange({ ...filters, orderRef: event.target.value })}
        />
      </div>
      {filters.mailboxId !== null ? (
        <button type="button" className="filter-chip" onClick={() => onChange({ ...filters, mailboxId: null })} aria-label="清除收件地址筛选">
          <Tag>收件地址 #{filters.mailboxId}</Tag>
          <X />
        </button>
      ) : null}
      <span className="spacer" />
      <Button variant="primary" onClick={onCreate}>
        <Plus />
        生成取件链接
      </Button>
    </div>
  );
}

export type BatchKind = "extend" | "pause" | "resume" | "revoke" | "set_rule_group" | "export";

type BatchBarProps = {
  count: number;
  busy: boolean;
  onAction: (kind: BatchKind) => void;
  onClear: () => void;
};

/** 批量条：与工具栏同一位置互换，不推动表格 */
export function BatchBar({ count, busy, onAction, onClear }: BatchBarProps) {
  return (
    <div className="toolbar link-batch-bar" role="toolbar" aria-label="批量操作">
      <span className="link-batch-count num">已选 {count} 项</span>
      <Button disabled={busy} onClick={() => onAction("extend")}>
        <CalendarPlus />
        延长有效期
      </Button>
      <Button disabled={busy} onClick={() => onAction("pause")}>
        <Pause />
        暂停
      </Button>
      <Button disabled={busy} onClick={() => onAction("resume")}>
        <Play />
        恢复
      </Button>
      <Button disabled={busy} onClick={() => onAction("set_rule_group")}>
        <Replace />
        换规则组
      </Button>
      <Button disabled={busy} onClick={() => onAction("export")}>
        <Download />
        导出
      </Button>
      <span className="spacer" />
      <Button variant="danger-ghost" disabled={busy} onClick={() => onAction("revoke")}>
        <Ban />
        撤销
      </Button>
      <Button variant="ghost" onClick={onClear}>
        取消选择
      </Button>
    </div>
  );
}
