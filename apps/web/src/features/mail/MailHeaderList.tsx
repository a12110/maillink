export type MailHeader = { key: string; value: string };

/** 邮件头：键值逐行（同名头如 Received 会出现多次，所以不按 key 去重），值全部是纯文本 */
export function MailHeaderList({ headers }: { headers: ReadonlyArray<MailHeader> }) {
  if (headers.length === 0) return <p className="mail-empty">（没有可显示的邮件头）</p>;
  return (
    <dl className="mail-headers">
      {headers.map((header, index) => (
        <div key={index} className="mail-header-row">
          <dt>{header.key}</dt>
          <dd>{header.value}</dd>
        </div>
      ))}
    </dl>
  );
}
