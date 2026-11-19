type MailTextProps = { text: string };

/**
 * 纯文本正文：按原样换行显示，不自动链接化（裸域名、IPv4、URL 都保持不可点），不用 dangerouslySetInnerHTML。
 * React 对文本节点自动转义，邮件里的 `<script>` 等只会显示成文字。
 */
export function MailText({ text }: MailTextProps) {
  if (text === "") return <p className="mail-empty">（这封邮件没有正文）</p>;
  return <div className="mail-text">{text}</div>;
}
