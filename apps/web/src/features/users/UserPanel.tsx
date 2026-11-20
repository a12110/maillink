import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { AdminUser } from "@maillink/shared";
import { api } from "../../api/instance";
import { adminUserQuery, queryKeys, sessionQuery } from "../../api/queries";
import { DESKTOP_MEDIA_QUERY } from "../../constants";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { describeError } from "../../lib/messages";
import { Button, CloseIconButton, ConfirmDialog, ErrorCallout, useToast } from "../../ui";
import { GrantsSection } from "./GrantsSection";
import { LoginMethodsSection } from "./LoginMethodsSection";
import { ProfileSection } from "./ProfileSection";

function DeleteSection({ user, onDeleted }: { user: AdminUser; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const isSelf = useQuery(sessionQuery()).data?.user.id === user.id;
  const remove = useMutation({
    mutationFn: () => api.deleteUser(user.id),
    onSuccess: async () => {
      setOpen(false);
      onDeleted();
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
      toast.success(`已删除用户 ${user.username}`);
    },
  });
  const consequence = `将级联删除 ${user.username} 的凭据、会话与邮箱授权，无法撤销。${isSelf ? "这是你自己的账号，删除后你会被立即退出登录。" : ""}`;
  return (
    <section className="panel-section" aria-labelledby="danger-title">
      <h3 className="section-title" id="danger-title">删除用户</h3>
      <p className="section-lead">删除后该用户无法再登录，相关数据一并清除。</p>
      <div className="form-actions">
        <Button variant="danger-ghost" onClick={() => { remove.reset(); setOpen(true); }}>删除用户</Button>
      </div>
      <ConfirmDialog open={open} onOpenChange={setOpen} title={`删除用户 ${user.username}？`} consequence={consequence}
        confirmLabel="删除用户" busyLabel="删除中…" busy={remove.isPending}
        error={remove.isError ? describeError(remove.error) : null} onConfirm={() => remove.mutate()} />
    </section>
  );
}

type UserPanelProps = { userId: number; onClose: () => void };

/**
 * 用户详情侧板：非模态，保持列表可见。
 * 窄屏（<1024）它是全屏浮层：打开时焦点移到标题；Esc 关闭（只响应面板内部的按键，
 * 面板里弹出的 Radix 对话框在 portal 里，不是 DOM 后代，不会被误关）。
 */
export function UserPanel({ userId, onClose }: UserPanelProps) {
  const { data: user, error, isPending, refetch } = useQuery(adminUserQuery(userId));
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!isDesktop) headingRef.current?.focus();
    // 只在打开时（或切换到窄屏时）移焦点，不随用户数据刷新反复抢焦点
  }, [isDesktop]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && event.currentTarget.contains(event.target as Node)) onClose();
  };

  return (
    <aside className="sidepanel" aria-label="用户详情" onKeyDown={onKeyDown}>
      <div className="sidepanel-head">
        <h2 ref={headingRef} tabIndex={-1}>{user ? user.username : "用户详情"}</h2>
        <CloseIconButton label="关闭详情" onClick={onClose} />
      </div>
      <div className="sidepanel-body">
        {isPending ? <span className="skeleton" aria-label="加载中" /> : null}
        {error ? <ErrorCallout title="用户详情加载失败" {...describeError(error)} onRetry={() => void refetch()} /> : null}
        {user ? (
          <>
            <ProfileSection key={user.id} user={user} />
            <LoginMethodsSection user={user} />
            <GrantsSection user={user} />
            <DeleteSection user={user} onDeleted={onClose} />
          </>
        ) : null}
      </div>
    </aside>
  );
}
