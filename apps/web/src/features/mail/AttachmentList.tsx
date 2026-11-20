import { Download, Paperclip } from "lucide-react";
import { formatBytes } from "./labels";

/** 管理端附件（带 content_type）与规则组呈现后的附件（带 downloadable，没有 content_type）共用 */
export type AttachmentItem = { index: number; name: string; size: number; content_type?: string; downloadable?: boolean };

type AttachmentListProps = {
  attachments: ReadonlyArray<AttachmentItem>;
  /** 下载地址由调用方决定（管理端、用户收件箱、取件页的接口不同） */
  hrefFor: (attachment: AttachmentItem) => string;
};

/** 附件列表：文件名与类型是纯文本；下载走后端的 attachment 响应（一律 octet-stream） */
export function AttachmentList({ attachments, hrefFor }: AttachmentListProps) {
  if (attachments.length === 0) return <p className="mail-empty">（没有附件）</p>;
  return (
    <ul className="mail-attachments">
      {attachments.map((attachment) => (
        <li key={attachment.index}>
          <Paperclip />
          <span className="mail-attachment-name" title={attachment.name}>
            {attachment.name === "" ? "（未命名附件）" : attachment.name}
          </span>
          <span className="mail-attachment-meta">
            {attachment.content_type === undefined ? "" : `${attachment.content_type} · `}
            {formatBytes(attachment.size)}
          </span>
          {attachment.downloadable === false ? (
            <span className="mail-attachment-meta" title="这个规则组不允许下载附件">不可下载</span>
          ) : (
            <a className="btn" data-variant="ghost" data-size="sm" href={hrefFor(attachment)} download>
              <Download />
              下载
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
