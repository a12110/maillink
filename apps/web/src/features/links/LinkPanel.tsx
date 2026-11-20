import { useQuery } from "@tanstack/react-query";
import { Ban, CalendarPlus, Copy, Eye, KeyRound, Pause, Play, RefreshCw, Replace, Smartphone } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { AdminShareLink } from "@maillink/shared";
import { adminLinkQuery } from "../../api/links-queries";
import { DESKTOP_MEDIA_QUERY } from "../../constants";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { describeError } from "../../lib/messages";
import { Button, Callout, CloseIconButton, ErrorCallout } from "../../ui";
import { linkTitle } from "./labels";
import { LogsSection } from "./PanelLogs";
import { PreviewSection } from "./PanelPreview";
import { AccessSection, OverviewSection, StatsSection } from "./PanelSections";

export type LinkAction = "copy" | "rebind" | "reset" | "extend" | "pause" | "resume" | "revoke" | "rotate";

type ActionsProps = { link: AdminShareLink; onAction: (action: LinkAction, link: AdminShareLink) => void; onPreview: () => void };

function ActionsSection({ link, onAction, onPreview }: ActionsProps) {
  const revoked = link.status === "revoked";
  const act = (action: LinkAction) => () => onAction(action, link);
  return (
    <section className="panel-section" aria-labelledby="link-actions">
      <h3 className="section-title" id="link-actions">操作</h3>
      {revoked ? <Callout tone="info" title="这个链接已撤销">撤销是终态，不能恢复或再修改；需要继续使用请新建链接。</Callout> : null}
      <div className="action-grid">
        <Button onClick={act("copy")}><Copy />复制链接</Button>
        <Button onClick={onPreview}><Eye />预览</Button>
        <Button onClick={act("rebind")} disabled={revoked}><Replace />换绑收件地址</Button>
        <Button onClick={act("reset")} disabled={revoked}><Smartphone />重置设备</Button>
        <Button onClick={act("extend")} disabled={revoked}><CalendarPlus />延长有效期</Button>
        {link.status === "paused" ? (
          <Button onClick={act("resume")} disabled={revoked}><Play />恢复</Button>
        ) : (
          <Button onClick={act("pause")} disabled={revoked}><Pause />暂停</Button>
        )}
        <Button variant="danger-ghost" onClick={act("rotate")} disabled={revoked}><KeyRound />重置 token</Button>
        <Button variant="danger-ghost" onClick={act("revoke")} disabled={revoked}><Ban />撤销</Button>
      </div>
    </section>
  );
}

type PanelProps = {
  linkId: number;
  /** 行内“预览”图标打开侧板时直接跑预览 */
  autoPreview: boolean;
  onAutoPreviewDone: () => void;
  onClose: () => void;
  onAction: ActionsProps["onAction"];
};

/**
 * 链接详情侧板：非模态，保持列表可见。窄屏（<1024）是全屏浮层：打开时焦点移到标题；Esc 只响应面板内部按键
 * （面板里弹出的 Radix 对话框在 portal 里，不是 DOM 后代，不会误关）。
 */
export function LinkPanel({ linkId, autoPreview, onAutoPreviewDone, onClose, onAction }: PanelProps) {
  const { data: link, error, isPending, isFetching, refetch } = useQuery(adminLinkQuery(linkId));
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [previewTick, setPreviewTick] = useState(0);
  useEffect(() => {
    if (!isDesktop) headingRef.current?.focus();
  }, [isDesktop]);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && event.currentTarget.contains(event.target as Node)) onClose();
  };
  const runPreview = useCallback(() => setPreviewTick((value) => value + 1), []);
  return (
    <aside className="sidepanel" aria-label="取件链接详情" onKeyDown={onKeyDown}>
      <div className="sidepanel-head">
        <h2 ref={headingRef} tabIndex={-1}>{link ? linkTitle(link) : "链接详情"}</h2>
        <Button variant="ghost" size="sm" iconOnly aria-label="刷新详情" title="刷新" onClick={() => void refetch()} busy={isFetching && !isPending}><RefreshCw /></Button>
        <CloseIconButton label="关闭详情" onClick={onClose} />
      </div>
      <div className="sidepanel-body">
        {isPending ? <span className="skeleton" aria-label="加载中" /> : null}
        {error ? <ErrorCallout title="链接详情加载失败" {...describeError(error)} onRetry={() => void refetch()} /> : null}
        {link ? (
          <>
            <OverviewSection link={link} />
            <ActionsSection link={link} onAction={onAction} onPreview={runPreview} />
            <AccessSection link={link} />
            <StatsSection link={link} />
            <PreviewSection linkId={link.id} autoRun={autoPreview || previewTick > 0} onAutoRunDone={() => { onAutoPreviewDone(); setPreviewTick(0); }} />
            <LogsSection linkId={link.id} />
          </>
        ) : null}
      </div>
    </aside>
  );
}
