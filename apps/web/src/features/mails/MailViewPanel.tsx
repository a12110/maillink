import type { AdminMailDetail } from "@maillink/shared";
import { Callout, Checkbox } from "../../ui";
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
  remoteImages: boolean;
  onRemoteImages: (allow: boolean) => void;
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

/** 远程图片开关：默认阻止（防追踪像素泄露 IP）；打开后重新请求详情（?remote_images=allow），只对当前查看生效 */
function RemoteImagesToggle({ allow, onChange }: { allow: boolean; onChange: (allow: boolean) => void }) {
  return (
    <div className="mail-remote-images">
      <Checkbox checked={allow} onChange={(event) => onChange(event.target.checked)}>加载远程图片</Checkbox>
      <span className="field-hint">
        {allow ? "已允许：发件方可通过图片请求得知你的 IP 与打开时间。" : "默认阻止，避免追踪像素泄露你的 IP 与打开时间。"}
      </span>
    </div>
  );
}

export function MailViewPanel({ detail, view, rawLoading, remoteImages, onRemoteImages }: MailViewPanelProps) {
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
  const html = parsed.html ?? null;
  return (
    <>
      <TruncatedNote show={parsed.body_truncated} />
      {html !== null ? <RemoteImagesToggle allow={remoteImages} onChange={onRemoteImages} /> : null}
      <MailBody html={html} text={parsed.body} hasHtml={parsed.has_html} title={`邮件 ${detail.id} 的正文`} />
    </>
  );
}
