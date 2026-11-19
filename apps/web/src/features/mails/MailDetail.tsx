import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { adminMailAttachmentPath } from "../../api/endpoints";
import { adminMailQuery } from "../../api/queries";
import { describeError } from "../../lib/messages";
import { ErrorCallout, Segmented } from "../../ui";
import { AttachmentList } from "../mail";
import { MailFacts, MailHeading, MailLinks } from "./MailDetailSections";
import { MailViewPanel, VIEW_OPTIONS } from "./MailViewPanel";
import type { MailView } from "./MailViewPanel";

type MailDetailProps = { id: number; onBack: () => void };

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="mail-back" onClick={onBack}>
      <ArrowLeft />
      返回列表
    </button>
  );
}

function toView(value: string): MailView {
  const option = VIEW_OPTIONS.find((candidate) => candidate.value === value);
  if (!option) throw new Error(`未知的邮件视图：${value}`);
  return option.value;
}

/** 右侧详情：标题、收件与信封、视图切换（正文 / 纯文本 / 原文 / 邮件头）、链接、附件 */
export function MailDetail({ id, onBack }: MailDetailProps) {
  const [chosen, setChosen] = useState<MailView | null>(null);
  // 一旦看过原文，后面的请求都带 raw=1，在几个视图间来回切换不再重新请求
  const [rawRequested, setRawRequested] = useState(false);
  const query = useQuery(adminMailQuery(id, rawRequested));
  const detail = query.data;

  if (!detail) {
    return (
      <div className="mail-detail-body">
        <BackButton onBack={onBack} />
        {query.isError ? (
          <ErrorCallout title="邮件详情加载失败" {...describeError(query.error)} onRetry={() => void query.refetch()} />
        ) : (
          <span className="skeleton mail-detail-skeleton" role="status" aria-label="正在加载邮件" />
        )}
      </div>
    );
  }

  // 解析失败的邮件默认直接看原文（这时还没请求过 raw=1，补上）
  const view = chosen ?? (detail.parsed === null ? "raw" : "body");
  if (view === "raw" && !rawRequested) setRawRequested(true);
  const rawLoading = detail.raw === undefined && query.isFetching;
  return (
    <div className="mail-detail-body">
      <BackButton onBack={onBack} />
      {query.isError ? (
        <ErrorCallout title="刷新邮件详情失败" {...describeError(query.error)} onRetry={() => void query.refetch()} />
      ) : null}
      <MailHeading detail={detail} />
      <MailFacts detail={detail} />
      <section className="mail-section" aria-label="邮件内容">
        <Segmented legend="查看方式" name="mail-view" value={view} options={VIEW_OPTIONS} onChange={(value) => setChosen(toView(value))} />
        <div className="mail-view">
          <MailViewPanel detail={detail} view={view} rawLoading={rawLoading} />
        </div>
      </section>
      {detail.parsed ? (
        <>
          <section className="mail-section">
            <h3 className="section-title">链接 · {detail.parsed.links.length}</h3>
            <MailLinks links={detail.parsed.links} />
          </section>
          <section className="mail-section">
            <h3 className="section-title">附件 · {detail.parsed.attachments.length}</h3>
            <AttachmentList attachments={detail.parsed.attachments} hrefFor={(a) => adminMailAttachmentPath(detail.id, a.index)} />
          </section>
        </>
      ) : null}
    </div>
  );
}
