import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import type { AdminOAuthProvider } from "@maillink/shared";
import { api } from "../../../api/instance";
import { oauthProvidersQuery, queryKeys } from "../../../api/queries";
import { Button, Callout, ConfirmDialog, EmptyState, ErrorCallout, SkeletonRows, Status, Tag, useToast } from "../../../ui";
import { describeSettingsError } from "../errors";
import { ProviderDialog } from "./ProviderDialog";
import type { ProviderTarget } from "./ProviderDialog";
import { draftFromProvider, toUpdateInput } from "./provider-form";

function useProviderActions(onStranded: (ids: number[]) => void) {
  const client = useQueryClient();
  const toast = useToast();
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.adminOAuthProviders }),
      client.invalidateQueries({ queryKey: queryKeys.publicConfig }),
    ]);
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteOAuthProvider(id),
    onSuccess: async (result) => {
      toast.success("提供方已删除");
      onStranded(result.users_without_login_method);
      await refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: async (provider: AdminOAuthProvider) => {
      // PUT 整体替换：用现有值转成草稿再翻转 enabled，client_secret 留空 = 保留原值
      const input = toUpdateInput({ ...draftFromProvider(provider), enabled: !provider.enabled });
      if (!input.ok) throw new Error(`现有配置无法再次提交：${Object.values(input.fields).join("；")}`);
      return api.updateOAuthProvider(provider.id, input.value);
    },
    onSuccess: async (result) => {
      toast.success(result.provider?.enabled ? "提供方已启用" : "提供方已停用");
      onStranded(result.users_without_login_method);
      await refresh();
    },
  });
  return { remove, toggle };
}

function ProviderRow({ provider, busy, onEdit, onToggle, onDelete }: {
  provider: AdminOAuthProvider;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <tr>
      <td><button type="button" className="row-link" onClick={onEdit}>{provider.name}</button></td>
      <td className="mono-cell">{provider.slug}</td>
      <td className="col-secondary"><Tag>{provider.kind === "oidc" ? "OIDC" : "OAuth2"}</Tag></td>
      <td><Status tone={provider.enabled ? "success" : "neutral"}>{provider.enabled ? "启用" : "停用"}</Status></td>
      <td className="col-optional">{provider.allow_signup ? <Tag>允许注册</Tag> : <span className="dim">—</span>}</td>
      <td className="col-num col-optional">{provider.sort}</td>
      <td>
        <div className="row-actions">
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`编辑 ${provider.name}`}>编辑</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onToggle} aria-label={`${provider.enabled ? "停用" : "启用"} ${provider.name}`}>
            {provider.enabled ? "停用" : "启用"}
          </Button>
          <Button size="sm" variant="danger-ghost" onClick={onDelete} aria-label={`删除 ${provider.name}`}>删除</Button>
        </div>
      </td>
    </tr>
  );
}

function StrandedNotice({ ids, onDismiss }: { ids: number[]; onDismiss: () => void }) {
  return (
    <Callout tone="warning" title={`${ids.length} 个用户现在没有任何可用的登录方式`}
      actions={<><Link to="/admin/users" className="text-action">去用户页设置密码</Link><button type="button" className="text-action" onClick={onDismiss}>知道了</button></>}>
      他们只能靠这个提供方登录（用户 id：{ids.join("、")}）。请为他们设置密码，或重新启用这个提供方。
    </Callout>
  );
}

type TableProps = {
  query: UseQueryResult<{ items: AdminOAuthProvider[] }>;
  busy: boolean;
  onEdit: (provider: AdminOAuthProvider) => void;
  onToggle: (provider: AdminOAuthProvider) => void;
  onDelete: (provider: AdminOAuthProvider) => void;
};

function ProviderTable({ query, busy, onEdit, onToggle, onDelete }: TableProps) {
  const items = query.data?.items ?? [];
  return (
    <div className="panel table-scope">
      <table className="table">
        <colgroup><col /><col data-w="md" /><col className="col-secondary" data-w="sm" /><col data-w="sm" /><col className="col-optional" data-w="md" /><col className="col-optional" data-w="xs" /><col data-w="xl" /></colgroup>
        <thead><tr><th>名称</th><th>slug</th><th className="col-secondary">类型</th><th>状态</th><th className="col-optional">注册</th><th className="col-num col-optional">排序</th><th><span className="sr-only">操作</span></th></tr></thead>
        <tbody>
          {query.isPending ? <SkeletonRows rows={3} columns={7} /> : items.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} busy={busy}
              onEdit={() => onEdit(provider)} onToggle={() => onToggle(provider)} onDelete={() => onDelete(provider)} />
          ))}
        </tbody>
      </table>
      {!query.isPending && items.length === 0 ? (
        <EmptyState icon={KeyRound} title="还没有 OAuth 提供方" description="添加后，在“注册与登录”里允许 OAuth 登录，用户才能用第三方账号登录。" />
      ) : null}
    </div>
  );
}

type DeleteProps = { provider: AdminOAuthProvider | null; mutation: ReturnType<typeof useProviderActions>["remove"]; onClose: () => void };

function DeleteProviderDialog({ provider, mutation, onClose }: DeleteProps) {
  return (
    <ConfirmDialog open={provider !== null} onOpenChange={(open) => { if (!open) { onClose(); mutation.reset(); } }}
      title={`删除提供方“${provider?.name ?? ""}”？`}
      consequence="会同时解除所有用户对它的绑定，操作不可撤销。只靠它登录的用户将没有登录方式，需要管理员为其设置密码。"
      confirmLabel="删除" busyLabel="删除中…" busy={mutation.isPending}
      error={mutation.isError ? describeSettingsError(mutation.error) : null}
      onConfirm={() => provider && mutation.mutate(provider.id, { onSuccess: onClose })} />
  );
}

export function OAuthProviders() {
  const query = useQuery(oauthProvidersQuery());
  const [target, setTarget] = useState<ProviderTarget | null>(null);
  const [deleting, setDeleting] = useState<AdminOAuthProvider | null>(null);
  const [stranded, setStranded] = useState<number[]>([]);
  const { remove, toggle } = useProviderActions(setStranded);

  return (
    <div className="settings-form" data-wide="true">
      <div className="section-row">
        <p className="section-lead">登录页只显示已启用的提供方，按排序从小到大。</p>
        <Button variant="primary" onClick={() => setTarget({ mode: "create" })}><Plus />添加提供方</Button>
      </div>
      {stranded.length > 0 ? <StrandedNotice ids={stranded} onDismiss={() => setStranded([])} /> : null}
      {toggle.isError ? <ErrorCallout title="切换启用状态失败" {...describeSettingsError(toggle.error)} /> : null}
      {query.isError ? (
        <ErrorCallout title="提供方列表读取失败" {...describeSettingsError(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <ProviderTable query={query} busy={toggle.isPending} onToggle={(provider) => toggle.mutate(provider)}
          onEdit={(provider) => setTarget({ mode: "edit", provider })} onDelete={setDeleting} />
      )}
      <ProviderDialog target={target} onClose={() => setTarget(null)} onSaved={setStranded} />
      <DeleteProviderDialog provider={deleting} mutation={remove} onClose={() => setDeleting(null)} />
    </div>
  );
}
