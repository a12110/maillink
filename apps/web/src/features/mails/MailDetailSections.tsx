import type { ReactNode } from "react";
import type { AdminMailDetail } from "@maillink/shared";
import { formatFullDateTime } from "../../lib/format";
import { Copy } from "lucide-react";
import { Button, Tag } from "../../ui";
import { CATEGORY_LABEL, CODE_SOURCE_LABEL, formatBytes, formatSender, isHttpUrl } from "../mail";
import { useCopy } from "../mail/useCopy";

type Parsed = NonNullable<AdminMailDetail["parsed"]>;

function Dash() {
  return <span className="dim">—</span>;
}

function Mono({ value }: { value: string | null }) {
  return value === null || value === "" ? <Dash /> : <span className="mono">{value}</span>;
}

function FromLine({ detail }: { detail: AdminMailDetail }) {
  if (detail.parsed === null) {
    const source = detail.envelope.source;
    return <span className="dim">{source === null ? "—" : `信封发件人 ${source}`}</span>;
  }
  return formatSender(detail.parsed.from) ?? <span className="dim">没有发件人（From）</span>;
}

/** 标题区：主题、发件人、时间与状态标签 */
export function MailHeading({ detail }: { detail: AdminMailDetail }) {
  const { parsed } = detail;
  return (
    <header className="mail-heading">
      <h2 className="mail-subject">{parsed ? parsed.subject || "（无主题）" : "（邮件解析失败）"}</h2>
      <p className="mail-from">
        <FromLine detail={detail} />
      </p>
      <p className="mail-when num">{formatFullDateTime(detail.received_at)} · #{detail.id}</p>
      <div className="mail-heading-tags">
        {parsed === null ? <Tag tone="warning">解析失败</Tag> : <Tag>{CATEGORY_LABEL[parsed.category]}</Tag>}
        {parsed && parsed.attachments.length > 0 ? <Tag>附件 {parsed.attachments.length}</Tag> : null}
      </div>
    </header>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function List({ values }: { values: readonly string[] }) {
  if (values.length === 0) return <Dash />;
  return (
    <span className="mail-chip-list">
      {values.map((value) => (
        <span key={value} className="mono">
          {value}
        </span>
      ))}
    </span>
  );
}

function CodeValue({ parsed }: { parsed: Parsed }) {
  if (parsed.code === null) return <Dash />;
  return (
    <>
      <span className="mail-code mono">{parsed.code}</span>
      {parsed.code_source ? <span className="dim"> 来源：{CODE_SOURCE_LABEL[parsed.code_source]}</span> : null}
    </>
  );
}

/** 收件、信封与解析结果的键值表；解析失败时只有收件与信封部分 */
export function MailFacts({ detail }: { detail: AdminMailDetail }) {
  const { parsed, envelope } = detail;
  return (
    <dl className="kv mail-facts">
      <Row label="收件地址">
        <Mono value={detail.recipient} />
      </Row>
      <Row label="邮件头收件人">
        <Mono value={envelope.to_address} />
      </Row>
      <Row label="信封收件人">
        <Mono value={envelope.address} />
      </Row>
      <Row label="信封发件人">
        <Mono value={envelope.source} />
      </Row>
      {parsed ? (
        <>
          <Row label="候选发件人">
            <List values={parsed.sender_candidates.addresses} />
          </Row>
          <Row label="候选域名">
            <List values={parsed.sender_candidates.domains} />
          </Row>
          <Row label="验证码">
            <CodeValue parsed={parsed} />
          </Row>
        </>
      ) : null}
      <Row label="原文大小">{detail.raw_size === null ? <Dash /> : formatBytes(detail.raw_size)}</Row>
    </dl>
  );
}

function hostOf(link: string): string | null {
  if (!isHttpUrl(link)) return null;
  try {
    return new URL(link).hostname;
  } catch {
    return null;
  }
}

function LinkItem({ link }: { link: string }) {
  const { copy, error } = useCopy();
  const host = hostOf(link);
  return (
    <li>
      <span className="mail-link-text mono">{link}</span>
      <span className="mail-link-actions">
        {host ? <span className="dim mono">{host}</span> : null}
        <Button size="sm" onClick={() => void copy(link, "已复制链接")} aria-label={`复制链接 ${link}`}>
          <Copy />
          复制
        </Button>
      </span>
      {error ? <span className="field-error">复制失败：{error}</span> : null}
    </li>
  );
}

/**
 * 链接：一律等宽纯文本 + “复制”，不产生任何 <a>。
 * 这些链接来自不可信邮件，常是一次性登录 / 确认链接，点一下就可能替买家消耗令牌或确认操作。
 */
export function MailLinks({ links }: { links: readonly string[] }) {
  if (links.length === 0) return <p className="mail-empty">（没有链接）</p>;
  return (
    <ul className="mail-links">
      {links.map((link, index) => (
        <LinkItem key={index} link={link} />
      ))}
    </ul>
  );
}
