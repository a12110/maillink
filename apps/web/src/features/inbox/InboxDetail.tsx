import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import type { PresentedMail } from "@maillink/shared";
import { myMailAttachmentPath } from "../../api/endpoints-auth";
import { isApiError } from "../../api/errors";
import { myMailQuery } from "../../api/queries-auth";
import { formatFullDateTime } from "../../lib/format";
import { describeError } from "../../lib/messages";
import { Callout, ErrorCallout } from "../../ui";
import { AttachmentList, MailBody } from "../mail";
import { presentedSender } from "./inbox-model";

type Props = { id: number; mailboxId: number | undefined; onBack: () => void };

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="mail-back" onClick={onBack}>
      <ArrowLeft />
      返回列表
    </button>
  );
}

/** 详情还没有数据：404 说明这个范围没有详情；其他错误可重试；否则骨架 */
function Pending({ query }: { query: UseQueryResult<PresentedMail> }) {
  if (!query.isError) return <span className="skeleton mail-detail-skeleton" role="status" aria-label="正在加载邮件" />;
  if (isApiError(query.error, "not_found")) {
    return <Callout title="这封邮件没有详情">可能是这个邮箱只显示验证码或邮件摘要，也可能邮件已经不在你能看到的范围内。</Callout>;
  }
  return <ErrorCallout title="邮件详情加载失败" {...describeError(query.error)} onRetry={() => void query.refetch()} />;
}

function Heading({ mail }: { mail: PresentedMail }) {
  const sender = presentedSender(mail.sender);
  return (
    <header className="mail-heading">
      <h2 className="mail-subject">{mail.subject === undefined ? "（主题已隐藏）" : mail.subject || "（无主题）"}</h2>
      <p className="mail-from">{sender ?? <span className="dim">发件人已隐藏</span>}</p>
      <p className="mail-when num">
        {formatFullDateTime(mail.received_at)}
        {mail.recipient === undefined ? "" : ` · 收件：${mail.recipient}`}
      </p>
    </header>
  );
}

function Attachments({ mail, mailboxId }: { mail: PresentedMail; mailboxId: number | undefined }) {
  if (!mail.attachments || mail.attachments.length === 0) return null;
  return (
    <section className="mail-section">
      <h3 className="section-title">附件 · {mail.attachments.length}</h3>
      <AttachmentList attachments={mail.attachments} hrefFor={(a) => myMailAttachmentPath(mail.id, a.index, mailboxId)} />
    </section>
  );
}

/**
 * 邮件详情：正文严格走 `features/mail` 的组件。`html` 只有 full 视图才有，原样进沙箱 iframe（`MailHtmlFrame`）；
 * 没有 `html`（text 视图，或后端清洗失败只给文本）时显示纯文本（`MailText`，不链接化）。主题、发件人、收件地址一律纯文本。
 */
export function InboxDetail({ id, mailboxId, onBack }: Props) {
  const query = useQuery(myMailQuery(id, mailboxId));
  const mail = query.data;
  return (
    <div className="mail-detail-body">
      <BackButton onBack={onBack} />
      {mail ? (
        <>
          <Heading mail={mail} />
          <section className="mail-section" aria-label="邮件内容">
            <div className="mail-view">
              <MailBody html={mail.html ?? null} text={mail.text ?? ""} hasHtml={false} title={`邮件 ${mail.id} 的正文`} />
            </div>
          </section>
          <Attachments mail={mail} mailboxId={mailboxId} />
        </>
      ) : (
        <Pending query={query} />
      )}
    </div>
  );
}
