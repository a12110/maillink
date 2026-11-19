import { Download, Paperclip } from "lucide-react";
import type { MailAttachment } from "@maillink/shared";
import { formatBytes } from "./labels";

type AttachmentListProps = {
  attachments: ReadonlyArray<MailAttachment>;
  /** 下载地址由调用方决定（管理端与取件页的接口不同） */
  hrefFor: (attachment: MailAttachment) => string;
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
            {attachment.content_type} · {formatBytes(attachment.size)}
          </span>
          <a className="btn" data-variant="ghost" data-size="sm" href={hrefFor(attachment)} download>
            <Download />
            下载
          </a>
        </li>
      ))}
    </ul>
  );
}
