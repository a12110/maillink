import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import type { MySession } from "@maillink/shared";
import { api } from "../../api/instance";
import { mySessionsQuery, queryKeys } from "../../api/queries";
import { describeAuthMethod, describeUserAgent, formatDateTime } from "../../lib/format";
import { describeError } from "../../lib/messages";
import { Button, ConfirmDialog, EmptyState, ErrorCallout, SkeletonRows, Tag, useToast } from "../../ui";

const SKELETON_ROWS = 3;
const COLUMN_COUNT = 6;

function SessionRow({ session, busy, onRevoke }: { session: MySession; busy: boolean; onRevoke: (s: MySession) => void }) {
  return (
    <tr>
      <td>
        {describeUserAgent(session.user_agent)}
        {session.current ? <> <Tag tone="info">当前会话</Tag></> : null}
      </td>
      <td className="col-optional mono-cell">{session.ip ?? <span className="dim">—</span>}</td>
      <td className="col-optional">{session.auth_methods.map(describeAuthMethod).join("、") || <span className="dim">—</span>}</td>
      <td className="col-optional time">{formatDateTime(session.created_at)}</td>
      <td className="col-secondary time">{formatDateTime(session.last_seen_at)}</td>
      <td className="col-num">
        {session.current ? (
          <span className="dim">用“退出登录”</span>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => onRevoke(session)}>注销</Button>
        )}
      </td>
    </tr>
  );
}

function SessionTable({ items, revokingId, onRevoke }: { items: MySession[]; revokingId: string | null; onRevoke: (s: MySession) => void }) {
  return (
    <table className="table">
      <colgroup><col /><col className="col-optional" data-w="md" /><col className="col-optional" data-w="sm" /><col className="col-optional" data-w="lg" /><col className="col-secondary" data-w="lg" /><col data-w="md" /></colgroup>
      <thead>
        <tr><th>设备</th><th className="col-optional">IP</th><th className="col-optional">登录方式</th><th className="col-optional">登录时间</th><th className="col-secondary">最近活动</th><th><span className="sr-only">操作</span></th></tr>
      </thead>
      <tbody>
        {items.map((s) => <SessionRow key={s.id} session={s} busy={revokingId === s.id} onRevoke={onRevoke} />)}
      </tbody>
    </table>
  );
}

type SessionList = { items: MySession[] } | undefined;

type BodyProps = {
  data: SessionList;
  error: unknown;
  isError: boolean;
  revokingId: string | null;
  onRevoke: (s: MySession) => void;
  onRetry: () => void;
};

function SessionsBody({ data, error, isError, revokingId, onRevoke, onRetry }: BodyProps) {
  if (isError) {
    return (
      <div className="card-pad">
        <ErrorCallout title="会话列表加载失败" {...describeError(error)} onRetry={onRetry} />
      </div>
    );
  }
  if (!data) {
    return (
      <table className="table" aria-busy="true">
        <tbody><SkeletonRows rows={SKELETON_ROWS} columns={COLUMN_COUNT} /></tbody>
      </table>
    );
  }
  if (data.items.length === 0) {
    return <EmptyState icon={MonitorSmartphone} title="没有登录会话" description="当前账号没有任何有效会话。" />;
  }
  return <SessionTable items={data.items} revokingId={revokingId} onRevoke={onRevoke} />;
}

function useRevoke(onDone: () => void) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (target: MySession | "others") => {
      // “注销其他会话”是一次请求 DELETE /api/me/sessions?scope=others，由服务端一次性处理
      if (target === "others") return (await api.revokeOtherSessions()).revoked;
      await api.revokeMySession(target.id);
      return 1;
    },
    onSuccess: (count) => {
      onDone();
      toast.success(`已注销 ${count} 个会话`);
    },
    // 无论成败都刷新，列表以服务端为准
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.mySessions }),
  });
}

export function SessionsSection() {
  const list = useQuery(mySessionsQuery());
  const [confirming, setConfirming] = useState<MySession | "others" | null>(null);
  const others = list.data?.items.filter((s) => !s.current) ?? [];
  const revoke = useRevoke(() => setConfirming(null));
  const ask = (target: MySession | "others") => {
    revoke.reset();
    setConfirming(target);
  };
  const isAll = confirming === "others";

  return (
    <section aria-labelledby="sessions-title">
      <div className="section-row">
        <h2 className="section-heading" id="sessions-title">登录会话</h2>
        <Button disabled={others.length === 0} onClick={() => ask("others")}>注销其他会话</Button>
      </div>
      <p className="section-lead">这些设备当前保持着你的登录状态。不认识的会话请立即注销并修改密码。</p>
      <div className="panel table-scope">
        <SessionsBody data={list.data} error={list.error} isError={list.isError}
          revokingId={revoke.isPending && confirming && confirming !== "others" ? confirming.id : null}
          onRevoke={ask} onRetry={() => void list.refetch()} />
      </div>
      <ConfirmDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}
        title={isAll ? "注销其他全部会话？" : "注销这个会话？"}
        consequence={isAll ? `将注销其他 ${others.length} 个设备上的登录，它们需要重新登录。当前设备不受影响。` : "该设备需要重新登录。"}
        confirmLabel="注销" busyLabel="注销中…" busy={revoke.isPending}
        error={revoke.isError ? describeError(revoke.error) : null}
        onConfirm={() => confirming && revoke.mutate(confirming)} />
    </section>
  );
}
