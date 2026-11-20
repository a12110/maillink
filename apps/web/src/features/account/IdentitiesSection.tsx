import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { useState } from "react";
import type { MyIdentity, PublicConfig } from "@maillink/shared";
import { oauthStartPath } from "../../api/endpoints-auth";
import { api } from "../../api/instance";
import { publicConfigQuery } from "../../api/queries";
import { authQueryKeys, myIdentitiesQuery } from "../../api/queries-auth";
import { describeAuthError } from "../../lib/auth-messages";
import { formatDateTime } from "../../lib/format";
import { Button, ConfirmDialog, ErrorCallout, useToast } from "../../ui";

function IdentityList({ items, onUnlink }: { items: MyIdentity[]; onUnlink: (identity: MyIdentity) => void }) {
  return (
    <ul className="item-list" aria-label="已绑定的第三方账号">
      {items.map((identity) => (
        <li key={identity.id}>
          <Link2 className="icon-lg" aria-hidden="true" />
          <span className="item-main">
            <b>{identity.provider.name}</b>
            <span className="item-meta">
              {identity.email ?? identity.display_name ?? "（提供方没有返回邮箱或名称）"} · 绑定于 {formatDateTime(identity.created_at)} ·{" "}
              {identity.last_login_at === null ? "还没有用它登录过" : `最近登录 ${formatDateTime(identity.last_login_at)}`}
            </span>
          </span>
          <Button size="sm" variant="danger-ghost" onClick={() => onUnlink(identity)}>解绑</Button>
        </li>
      ))}
    </ul>
  );
}

/** 可绑定的提供方：登录方式里开了 oauth 且还没绑定过的（同一个提供方只绑一个身份，重复绑定后端会回 already_linked） */
function bindable(config: PublicConfig | undefined, linked: MyIdentity[]) {
  if (!config?.login_methods.includes("oauth")) return [];
  const taken = new Set(linked.map((identity) => identity.provider.slug));
  return config.oauth_providers.filter((provider) => !taken.has(provider.slug));
}

function useUnlink(onDone: () => void) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: number) => api.deleteIdentity(id),
    onSuccess: async () => {
      toast.success("已解绑");
      onDone();
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.myIdentities });
    },
  });
}

type BodyProps = { items: MyIdentity[]; loaded: boolean; noProviders: boolean; onUnlink: (identity: MyIdentity) => void };

function Body({ items, loaded, noProviders, onUnlink }: BodyProps) {
  if (!loaded) return null;
  if (items.length === 0) {
    return <p className="item-empty">还没有绑定第三方账号。{noProviders ? "管理员暂未开放第三方登录。" : "在下面选择一个提供方开始绑定。"}</p>;
  }
  return <IdentityList items={items} onUnlink={onUnlink} />;
}

export function IdentitiesSection() {
  const list = useQuery(myIdentitiesQuery());
  const config = useQuery(publicConfigQuery());
  const [unlinking, setUnlinking] = useState<MyIdentity | null>(null);
  const unlink = useUnlink(() => setUnlinking(null));
  const items = list.data?.items ?? [];
  const free = bindable(config.data, items);
  const noProviders = config.data !== undefined && !config.data.login_methods.includes("oauth");

  return (
    <section aria-labelledby="identities-title" className="security-block">
      <h2 className="section-heading" id="identities-title">第三方账号</h2>
      <p className="section-lead">绑定后可以用第三方账号一键登录。绑定会先跳转到提供方授权，完成后回到本页。</p>
      {list.isError ? <ErrorCallout title="第三方账号加载失败" {...describeAuthError(list.error)} onRetry={() => void list.refetch()} /> : null}
      <Body items={items} loaded={list.data !== undefined} noProviders={noProviders}
        onUnlink={(identity) => { unlink.reset(); setUnlinking(identity); }} />
      <div className="form-actions">
        {free.map((provider) => (
          <a key={provider.slug} className="btn" data-variant="secondary" href={oauthStartPath(provider.slug, "link")}>
            绑定 {provider.name}
          </a>
        ))}
      </div>
      {unlinking ? (
        <ConfirmDialog open onOpenChange={(open) => !open && setUnlinking(null)} title={`解绑 ${unlinking.provider.name}？`}
          consequence="解绑后不能再用这个第三方账号登录。至少要保留一种登录方式（密码、通行密钥或其他第三方账号）。"
          confirmLabel="解绑" busyLabel="解绑中…" busy={unlink.isPending}
          error={unlink.isError ? describeAuthError(unlink.error) : null} onConfirm={() => unlink.mutate(unlinking.id)} />
      ) : null}
    </section>
  );
}
