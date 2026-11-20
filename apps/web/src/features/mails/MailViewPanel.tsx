import type { AdminMailDetail } from "@maillink/shared";
import { Callout } from "../../ui";
import { MailBody, MailHeaderList, MailRaw, MailText } from "../mail";

export type MailView = "body" | "text" | "raw" | "headers";

export const VIEW_OPTIONS = [
  { value: "body", label: "正文" },
  { value: "text", label: "纯文本" },
  { value: "raw", label: "原文" },
  { value: "headers", label: "邮件头" },
] as const satisfies ReadonlyArray<{ value: MailView; label: string }>;

type MailViewPanelProps = {
  detail: AdminMailDetail;
  view: MailView;
  /** 原文还在请求中 */
  rawLoading: boolean;
};

function TruncatedNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <Callout tone="warning" title="正文过长，只显示了开头一部分">
      完整内容请看“原文”。
    </Callout>
  );
}

function RawView({ detail, rawLoading }: { detail: AdminMailDetail; rawLoading: boolean }) {
  if (detail.raw !== undefined) return <MailRaw raw={detail.raw} />;
  if (rawLoading) return <span className="skeleton mail-raw-skeleton" role="status" aria-label="正在加载原文" />;
  return (
    <Callout tone="warning" title="原文不可用">
      {detail.parse_error ?? "后端没有返回原文"}
    </Callout>
  );
}

/** 解析失败时除“原文”外的视图：写明原因并指向原文，不显示空白 */
function ParseFailed({ error }: { error: string | null }) {
  return (
    <Callout tone="warning" title="邮件解析失败，没有可显示的内容">
      {error ?? "未知原因"}。可以切换到“原文”查看。
    </Callout>
  );
}

export function MailViewPanel({ detail, view, rawLoading }: MailViewPanelProps) {
  const { parsed } = detail;
  if (view === "raw") return <RawView detail={detail} rawLoading={rawLoading} />;
  if (parsed === null) return <ParseFailed error={detail.parse_error} />;
  if (view === "headers") return <MailHeaderList headers={parsed.headers} />;
  if (view === "text") {
    return (
      <>
        <TruncatedNote show={parsed.body_truncated} />
        <MailText text={parsed.body} />
      </>
    );
  }
  return (
    <>
      <TruncatedNote show={parsed.body_truncated} />
      <MailBody html={null} text={parsed.body} hasHtml={parsed.has_html} title={`邮件 ${detail.id} 的正文`} />
    </>
  );
}
