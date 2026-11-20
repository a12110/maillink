import { Link } from "@tanstack/react-router";
import type { RuleGroupTestItem } from "@maillink/shared";
import { formatRelative } from "../../../lib/format";
import { Tag } from "../../../ui";
import { CODE_ORIGIN_LABEL, describeHit, describeReason } from "./reasons";
import { VisitorPreview } from "./VisitorPreview";

function Extracted({ item }: { item: RuleGroupTestItem }) {
  const { extracted } = item;
  if (!extracted) return null;
  const origin = extracted.code_origin === null ? null : CODE_ORIGIN_LABEL[extracted.code_origin];
  return (
    <span>
      {extracted.code !== null ? <>提取到 <code>{extracted.code}</code>{origin ? `（${origin}）` : ""}</> : null}
      {extracted.code !== null && extracted.login_link !== null ? "；" : null}
      {extracted.login_link !== null ? <>提取到登录链接 <code>{extracted.login_link}</code></> : null}
    </span>
  );
}

function Reason({ item }: { item: RuleGroupTestItem }) {
  const reason = describeReason(item);
  return (
    <div className="t-reason">
      <Tag tone={reason.tone === "neutral" ? undefined : reason.tone}><span className="mono">{reason.tag}</span></Tag>
      <span>{reason.text}</span>
      {item.visible ? <Extracted item={item} /> : null}
    </div>
  );
}

function Matched({ item }: { item: RuleGroupTestItem }) {
  if (item.matched.length === 0) return null;
  return (
    <ul className="t-matched" aria-label="命中的规则">
      {item.matched.map((rule) => (
        <li key={rule.rule_id}>
          <Tag tone={rule.effect === "deny" ? "danger" : undefined}>{rule.effect === "deny" ? "屏蔽" : "允许"} · {rule.rule_name}</Tag>
          <span>{rule.hits.map(describeHit).join("；") || "（无条件细节）"}</span>
        </li>
      ))}
    </ul>
  );
}

const UNPARSED_TEXT = { pending: "尚未解析", failed: "无法解析" } as const;

function senderText(sender: NonNullable<RuleGroupTestItem["sender"]>): string | null {
  if (sender.name && sender.address) return `${sender.name} <${sender.address}>`;
  return sender.address ?? sender.name;
}

type FactProps = { className: string; label: string; value: string | null; unparsed: string; labelValue?: boolean };

/** 有值时只有 labelValue 才带标签（主题单独成行更醒目）；没有值时总是带标签，说明缺的是什么 */
function Fact({ className, label, value, unparsed, labelValue = false }: FactProps) {
  if (value === null) return <div className={`${className} t-unknown`}>{label}：{unparsed}</div>;
  if (value === "") return <div className={`${className} t-unknown`}>{label}：（空）</div>;
  return <div className={className} title={value}>{labelValue ? `${label}：` : ""}{value}</div>;
}

/** 管理员视角的主题与发件人（不受呈现设置影响，不可见的邮件也有）；解析失败 / 尚未解析时是弱化的占位文案，都按纯文本渲染 */
function MailFacts({ item }: { item: RuleGroupTestItem }) {
  const unparsed = item.parse_status === "pending" ? UNPARSED_TEXT.pending : UNPARSED_TEXT.failed;
  const sender = item.sender === null ? null : senderText(item.sender);
  return (
    <>
      <Fact className="t-subject" label="主题" value={item.subject} unparsed={unparsed} />
      <Fact className="t-sender" label="发件人" value={sender} unparsed={unparsed} labelValue />
    </>
  );
}

/** 一封邮件的试跑结果：可见 / 不可见、原因码、命中规则与条件、提取到的码，点开看访客视角预览 */
export function TesterItem({ item, now }: { item: RuleGroupTestItem; now: Date }) {
  const state = item.visible ? "ok" : item.reason_code === "parse_failed" || item.reason_code === "body_truncated" ? "warn" : "off";
  return (
    <li className="t-item">
      <div className="t-top">
        <span className="state" data-state={state}>
          <span className="dot" data-tone={item.visible ? "success" : state === "warn" ? "warning" : undefined} aria-hidden="true" />
          {item.visible ? "可见" : "不可见"}
        </span>
        <Link className="t-id mono" to="/admin/mails" search={{ id: item.mail_id }} title="在“全部邮件”里打开这封邮件">#{item.mail_id}</Link>
        <span className="from" title={item.recipient}>{item.recipient}</span>
        <span className="when" title={String(item.received_at)}>{formatRelative(item.received_at, now)}</span>
      </div>
      <MailFacts item={item} />
      <Reason item={item} />
      <Matched item={item} />
      {item.preview ? (
        <details className="t-preview-toggle">
          <summary>访客视角预览</summary>
          <VisitorPreview preview={item.preview} />
        </details>
      ) : null}
    </li>
  );
}
