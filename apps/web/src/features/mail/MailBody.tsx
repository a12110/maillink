import { Callout } from "../../ui";
import { MailHtmlFrame } from "./MailHtmlFrame";
import { MailText } from "./MailText";

type MailBodyProps = {
  /** 后端清洗后的 HTML 文档；后端尚未开放（M3b）或这封邮件没有 HTML 时为 null */
  html: string | null;
  text: string;
  /** 邮件原本带 HTML 正文（用来解释为什么现在只显示纯文本） */
  hasHtml: boolean;
  title: string;
};

/** “正文”视图：有 HTML 就进沙箱 iframe，否则显示纯文本并说明原因，不拿纯文本冒充 HTML */
export function MailBody({ html, text, hasHtml, title }: MailBodyProps) {
  if (html !== null) return <MailHtmlFrame html={html} title={title} />;
  return (
    <>
      {hasHtml ? (
        <Callout tone="info" title="HTML 正文将在后端开放后显示">
          这封邮件带有 HTML 正文，当前显示的是纯文本。
        </Callout>
      ) : null}
      <MailText text={text} />
    </>
  );
}
