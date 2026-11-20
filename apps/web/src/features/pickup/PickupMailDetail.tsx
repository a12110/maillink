import { ArrowLeft, Download, Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import type { PresentedMail } from "@maillink/shared";
import { formatFullDateTime } from "../../lib/format";
import { ErrorCallout } from "../../ui";
import { formatBytes, MailHtmlFrame, MailText } from "../mail";
import { describeMailError } from "./failures";
import { originOf } from "./mail-model";
import { pickupAttachmentHref } from "./pickup-api";
import type { PickupApi } from "./pickup-api";
import { formatAgo } from "./time";

type DetailProps = {
  token: string;
  id: number;
  api: Pick<PickupApi, "detail">;
  now: number;
  onBack: () => void;
};

type Loaded = { id: number; mail: PresentedMail } | { id: number; error: unknown };

function senderLine(mail: PresentedMail): string {
  const sender = mail.sender;
  if (!sender) return "未知";
  if (sender.name && sender.address) return `${sender.name} <${sender.address}>`;
  return originOf(mail) ?? "未知";
}

function Attachments({ token, mail }: { token: string; mail: PresentedMail }) {
  if (!mail.attachments || mail.attachments.length === 0) return null;
  return (
    <section className="mail-section">
      <h3 className="section-title">附件 · {mail.attachments.length}</h3>
      <ul className="mail-attachments">
        {mail.attachments.map((attachment) => (
          <li key={attachment.index}>
            <Paperclip />
            <span className="mail-attachment-name" title={attachment.name}>
              {attachment.name === "" ? "（未命名附件）" : attachment.name}
            </span>
            <span className="mail-attachment-meta">{formatBytes(attachment.size)}</span>
            {attachment.downloadable ? (
              <a className="btn" data-variant="ghost" data-size="sm" href={pickupAttachmentHref(token, mail.id, attachment.index)} download>
                <Download />
                下载
              </a>
            ) : (
              <span className="mail-attachment-meta">不可下载</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 邮件详情（`text` / `full` 视图）。正文：有清洗后的 HTML 就进沙箱 iframe（MailHtmlFrame，属性由它独占），
 * 否则按纯文本显示（不链接化、不用 dangerouslySetInnerHTML）；主题、发件人一律纯文本。
 */
export function PickupMailDetail({ token, id, api, now, onBack }: DetailProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api.detail(token, id).then(
      (mail) => {
        if (!cancelled) setLoaded({ id, mail });
      },
      (error: unknown) => {
        if (!cancelled) setLoaded({ id, error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, id, api, attempt]);

  const current = loaded?.id === id ? loaded : null;
  return (
    <article className="pk-article">
      <button type="button" className="pk-back" onClick={onBack}>
        <ArrowLeft />
        返回列表
      </button>
      {current === null ? <span className="skeleton mail-detail-skeleton" role="status" aria-label="正在加载邮件" /> : null}
      {current !== null && "error" in current ? (
        <ErrorCallout title="邮件详情加载失败" {...describeMailError(current.error)} onRetry={() => { setLoaded(null); setAttempt((value) => value + 1); }} />
      ) : null}
      {current !== null && "mail" in current ? <DetailBody token={token} mail={current.mail} now={now} /> : null}
    </article>
  );
}

function DetailBody({ token, mail, now }: { token: string; mail: PresentedMail; now: number }) {
  const title = mail.subject === undefined || mail.subject === "" ? "（无主题）" : mail.subject;
  return (
    <>
      <h2>{title}</h2>
      <dl>
        <dt>发件人</dt>
        <dd>{senderLine(mail)}</dd>
        <dt>时间</dt>
        <dd className="mono">
          {formatFullDateTime(mail.received_at)} · {formatAgo(mail.received_at, now)}
        </dd>
        {mail.recipient ? (
          <>
            <dt>收件</dt>
            <dd className="mono">{mail.recipient}</dd>
          </>
        ) : null}
      </dl>
      <div className="pk-body-wrap">
        {mail.html !== undefined ? <MailHtmlFrame html={mail.html} title={`邮件正文：${title}`} /> : <MailText text={mail.text ?? mail.snippet ?? ""} />}
      </div>
      <Attachments token={token} mail={mail} />
    </>
  );
}
