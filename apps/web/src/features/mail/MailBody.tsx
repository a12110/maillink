import { Callout } from "../../ui";
import { MailHtmlFrame } from "./MailHtmlFrame";
import { MailText } from "./MailText";

type MailBodyProps = {
  /** 后端清洗后的 HTML 文档，原样放进 srcDoc；这封邮件没有 HTML 部分或清洗失败时为 null */
  html: string | null;
  text: string;
  /** 邮件原本带 HTML 正文（用来解释为什么现在只显示纯文本） */
  hasHtml: boolean;
  title: string;
};

/** “正文”视图：有 HTML 就进沙箱 iframe，否则显示纯文本并说明原因（清洗失败只给纯文本，绝不回退原始 HTML） */
export function MailBody({ html, text, hasHtml, title }: MailBodyProps) {
  if (html !== null) return <MailHtmlFrame html={html} title={title} />;
  return (
    <>
      {hasHtml ? (
        <Callout tone="warning" title="这封邮件的 HTML 正文没有显示">
          后端没有返回清洗后的 HTML（清洗失败时只给纯文本，不会回退显示原始 HTML），当前显示的是纯文本。
        </Callout>
      ) : null}
      <MailText text={text} />
    </>
  );
}
