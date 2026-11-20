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
      {item.preview?.subject ? <div className="t-subject" title={item.preview.subject}>{item.preview.subject}</div> : null}
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
