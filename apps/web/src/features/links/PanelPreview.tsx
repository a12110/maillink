import { useQuery } from "@tanstack/react-query";
import { Check, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef } from "react";
import type { LinkPreviewResponse } from "@maillink/shared";
import { api } from "../../api/instance";
import { linkKeys } from "../../api/links-queries";
import { LINK_PREVIEW_MAILS } from "../../constants";
import { formatDateTime } from "../../lib/format";
import { describeError } from "../../lib/messages";
import { Button, Callout, ErrorCallout, Tag } from "../../ui";

type Item = LinkPreviewResponse["items"][number];

/** 不可见 / 被截掉 / 未解析的原因码 → 人话（reason 本身是 `deny:规则名` 之类的展示用原因） */
const REASON_TEXT: Record<string, string> = {
  no_allow_match: "没有命中任何允许规则",
  out_of_window: "不在时间范围内",
  parse_failed: "解析失败，按规则不显示",
  body_truncated: "正文过长被截断，不显示",
  no_code: "没有提取到验证码",
  max_mails: "超出“最多显示 N 封”的数量上限",
  pending: "这封邮件本次没轮到解析（partial），稍后重试",
};

export function reasonText(item: Pick<Item, "visible" | "reason" | "reason_code">): string {
  if (item.reason.startsWith("deny:")) return `被屏蔽规则“${item.reason.slice("deny:".length)}”挡住`;
  if (item.reason.startsWith("allow:")) return `命中允许规则“${item.reason.slice("allow:".length)}”`;
  if (item.reason_code === "blacklist_pass") return "黑名单模式：没有被任何屏蔽规则挡住";
  return REASON_TEXT[item.reason_code] ?? item.reason;
}

function VisitorView({ shown }: { shown: NonNullable<Item["preview"]> }) {
  const origin = shown.sender?.name ?? shown.sender?.domain;
  return (
    <div className="preview-visitor">
      <span className="dim">访问者看到：</span>
      {shown.code ? <span className="mail-code">{shown.code}</span> : null}
      {shown.subject ? <span>{shown.subject}</span> : null}
      {origin ? <span className="dim">{origin}</span> : null}
      {shown.locked ? <span className="dim">（点击取码方式：尚未显示）</span> : null}
    </div>
  );
}

function PreviewItem({ item }: { item: Item }) {
  return (
    <li className="preview-item" data-visible={item.visible}>
      <div className="preview-head">
        {item.visible ? <Tag tone="success"><Check className="tag-icon" aria-hidden="true" />显示</Tag> : <Tag><EyeOff className="tag-icon" aria-hidden="true" />不显示</Tag>}
        <span className="mono dim">#{item.mail_id} · {formatDateTime(item.received_at)}</span>
        {item.delivered ? <Tag tone="info">已交付</Tag> : null}
      </div>
      <p className="preview-reason">{reasonText(item)}</p>
      {item.preview ? <VisitorView shown={item.preview} /> : null}
    </li>
  );
}

/**
 * 预览：访问者视角 + 每封邮件为什么显示 / 不显示（管理员预览接口的 trace）。
 * 只读：不登记设备、不计次、不写访问日志；查询的是邮件库，所以点了才请求。
 */
export function PreviewSection({ linkId, autoRun, onAutoRunDone }: { linkId: number; autoRun: boolean; onAutoRunDone: () => void }) {
  const preview = useQuery({
    queryKey: [...linkKeys.all, "preview", linkId],
    queryFn: () => api.previewLink(linkId, LINK_PREVIEW_MAILS),
    enabled: false,
    gcTime: 0,
  });
  const ref = useRef<HTMLElement>(null);
  const { refetch } = preview;
  useEffect(() => {
    if (!autoRun) return;
    void refetch();
    ref.current?.scrollIntoView?.({ block: "start" });
    onAutoRunDone();
  }, [autoRun, refetch, onAutoRunDone]);
  const visible = preview.data?.items.filter((item) => item.visible).length ?? 0;
  return (
    <section className="panel-section" aria-labelledby="link-preview" ref={ref}>
      <h3 className="section-title" id="link-preview">预览（访问者视角）</h3>
      <p className="section-lead">按这条链接的规则组与起始时间，逐封看买家能看到什么、为什么。只读，不计次、不登记设备、不写访问日志。</p>
      <div>
        <Button onClick={() => void refetch()} busy={preview.isFetching} busyLabel="加载中…">
          <Eye />
          {preview.data ? "重新预览" : "加载预览"}
        </Button>
      </div>
      {preview.isError ? <ErrorCallout title="预览失败" {...describeError(preview.error)} onRetry={() => void refetch()} /> : null}
      {preview.data ? (
        <>
          {preview.data.partial ? <Callout tone="warning" title="有邮件还没解析完">结果不完整，稍后点“重新预览”。</Callout> : null}
          <p className="section-lead num">
            最近 {preview.data.items.length} 封邮件，其中 {visible} 封访问者能看到。
            {preview.data.time_lower_bound !== null ? `时间下界 ${formatDateTime(preview.data.time_lower_bound)}。` : ""}
          </p>
          {preview.data.items.length === 0 ? <p className="section-lead">这些收件地址最近没有邮件。</p> : null}
          <ul className="preview-list">
            {preview.data.items.map((item) => (
              <PreviewItem key={item.mail_id} item={item} />
            ))}
          </ul>
          <p className="section-lead num">已登记设备 {preview.data.visitors.length} 台，取码记录 {preview.data.deliveries.length} 条。</p>
        </>
      ) : null}
    </section>
  );
}
