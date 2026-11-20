import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ListFilter, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { AdminRuleGroupSummary } from "@maillink/shared";
import { api } from "../../api/instance";
import { adminRuleGroupsQuery, queryKeys } from "../../api/queries";
import { formatDateTime } from "../../lib/format";
import { describeError } from "../../lib/messages";
import { PageHeader } from "../../shell/PageHeader";
import { Button, ConfirmDialog, EmptyState, ErrorCallout, SkeletonRows, Status, Tag, useToast } from "../../ui";
import { NewRuleGroupDialog } from "./NewRuleGroupDialog";
import { VIEW_LABEL } from "./labels";

const SKELETON_ROWS = 6;

function UsageCell({ group }: { group: AdminRuleGroupSummary }) {
  if (group.link_count + group.grant_count === 0) return <span className="dim">未被使用</span>;
  return <span>被 {group.link_count} 个链接、{group.grant_count} 个授权使用</span>;
}

function StateCell({ group }: { group: AdminRuleGroupSummary }) {
  if (group.invalid) {
    return <span title={`配置无法通过校验（${group.invalid_code ?? "unknown"}）：引用它的链接和授权现在全部不可见，请打开编辑修复`}><Status tone="danger">配置无效</Status></span>;
  }
  return <Tag>{group.view === null ? "—" : VIEW_LABEL[group.view]}</Tag>;
}

function Row({ group, onDelete }: { group: AdminRuleGroupSummary; onDelete: () => void }) {
  const used = group.link_count + group.grant_count;
  return (
    <tr data-invalid={group.invalid}>
      <td title={group.name}>
        <Link className="row-link" to="/admin/rule-groups/$id" params={{ id: String(group.id) }}>{group.name}</Link>
      </td>
      <td className="col-optional dim-cell" title={group.description ?? undefined}>{group.description ?? <span className="dim">—</span>}</td>
      <td><StateCell group={group} /></td>
      <td className="col-optional"><UsageCell group={group} /></td>
      <td className="time col-secondary">{formatDateTime(group.updated_at)}</td>
      <td className="col-actions">
        <div className="row-actions" role="group" aria-label={`${group.name} 的操作`}>
          <Button variant="ghost" size="sm" iconOnly data-intent="danger" aria-label={`删除规则组 ${group.name}`} disabled={used > 0}
            title={used > 0 ? `仍被 ${group.link_count} 个链接、${group.grant_count} 个授权使用，先让它们改用别的规则组才能删除` : "删除规则组"} onClick={onDelete}>
            <Trash2 />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function Summary({ items }: { items: AdminRuleGroupSummary[] | undefined }) {
  if (!items) return null;
  const invalid = items.filter((group) => group.invalid).length;
  return (
    <>
      <span>共 <b className="num">{items.length}</b> 个规则组</span>
      {invalid > 0 ? <span className="summary-danger">配置无效 <b className="num">{invalid}</b></span> : null}
    </>
  );
}

function useDeleteGroup() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [target, setTarget] = useState<AdminRuleGroupSummary | null>(null);
  const mutation = useMutation({
    mutationFn: (id: number) => api.deleteRuleGroup(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminRuleGroups });
      toast.success(`已删除规则组「${target?.name ?? ""}」`);
      setTarget(null);
    },
  });
  return { target, setTarget: (next: AdminRuleGroupSummary | null) => { mutation.reset(); setTarget(next); }, mutation };
}

function Table({ items, onDelete }: { items: AdminRuleGroupSummary[] | undefined; onDelete: (group: AdminRuleGroupSummary) => void }) {
  return (
    <table className="table rule-group-table">
      <colgroup>
        <col className="col-name" />
        <col className="col-optional" />
        <col data-w="md" />
        <col className="col-optional" data-w="xl" />
        <col className="col-secondary" data-w="md" />
        <col data-w="xs" />
      </colgroup>
      <thead>
        <tr><th>名称</th><th className="col-optional">说明</th><th>呈现 / 状态</th><th className="col-optional">使用情况</th><th className="col-secondary">更新时间</th><th className="col-actions"><span className="sr-only">操作</span></th></tr>
      </thead>
      <tbody>
        {items ? items.map((group) => <Row key={group.id} group={group} onDelete={() => onDelete(group)} />) : <SkeletonRows rows={SKELETON_ROWS} columns={6} />}
      </tbody>
    </table>
  );
}

export function RuleGroupsPage() {
  const list = useQuery(adminRuleGroupsQuery());
  const [creating, setCreating] = useState(false);
  const del = useDeleteGroup();
  const items = list.data?.items;
  return (
    <>
      <PageHeader title="规则组" summary={<Summary items={items} />} />
      <div className="table-scope">
        <div className="toolbar">
          <span className="spacer" />
          <Button variant="primary" onClick={() => setCreating(true)}><Plus />新建规则组</Button>
        </div>
        <div className="panel">
          {list.isError ? (
            <div className="card-pad"><ErrorCallout title="规则组加载失败" {...describeError(list.error)} onRetry={() => void list.refetch()} /></div>
          ) : items?.length === 0 ? (
            <EmptyState icon={ListFilter} title="还没有规则组" description="规则组决定链接和授权能看到哪些邮件、显示多少。从内置模板开始最快。" action={<Button onClick={() => setCreating(true)}>新建规则组</Button>} />
          ) : (
            <Table items={items} onDelete={del.setTarget} />
          )}
        </div>
      </div>
      <NewRuleGroupDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog open={del.target !== null} onOpenChange={(open) => !open && del.setTarget(null)} title={`删除规则组「${del.target?.name ?? ""}」？`}
        consequence="删除后无法恢复，配置会一并丢失（审计日志里留有删除时的配置快照）。只有没被任何链接或授权使用的规则组才能删除。"
        confirmLabel="删除规则组" busyLabel="删除中…" busy={del.mutation.isPending} error={del.mutation.isError ? describeError(del.mutation.error) : null}
        onConfirm={() => del.target && del.mutation.mutate(del.target.id)} />
    </>
  );
}
