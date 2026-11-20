import { useRef, useState } from "react";
import { Button } from "../../ui";

/**
 * 沙箱属性的唯一出处：必须正好是这两项（PLAN「邮件 HTML 展示的硬性要求」第 1 条）。
 * 绝不加 allow-scripts / allow-same-origin / allow-forms / allow-top-navigation* / allow-downloads。
 */
export const MAIL_FRAME_SANDBOX = "allow-popups allow-popups-to-escape-sandbox";

type MailHtmlFrameProps = {
  /** 后端清洗并包装好的完整文档，原样放进 srcDoc，前后不拼任何东西 */
  html: string;
  title: string;
};

/**
 * 邮件 HTML 正文的隔离框。
 * 白底是有意的：邮件按白底设计，深色主题下 iframe 里透明的文档也要有浅色画布（样式里的
 * `color-scheme: light; background: Canvas`）。绝不能为了适配主题往 srcDoc 里注入样式或脚本（html 必须原样）。
 * 高度：没有 allow-same-origin，父页面读不到 iframe 内容高度，所以不做“自适应高度”：
 * 固定默认高度 + 框内滚动，可用右下角把手拖拽调整，或点“展开全高 / 收起”（触屏没有拖拽把手）。
 */
export function MailHtmlFrame({ html, title }: MailHtmlFrameProps) {
  const [expanded, setExpanded] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const toggle = () => {
    // 用户拖拽后高度写在 inline style 上，会盖过 data-expanded 的 CSS；切换前先清掉
    boxRef.current?.style.removeProperty("height");
    setExpanded((value) => !value);
  };
  return (
    <div className="mail-frame-block">
      <div ref={boxRef} className="mail-frame-box" data-expanded={expanded}>
        <iframe className="mail-frame" title={title} sandbox={MAIL_FRAME_SANDBOX} srcDoc={html} referrerPolicy="no-referrer" />
      </div>
      <div className="mail-frame-bar">
        <span>正文在隔离框内显示，不执行脚本；可拖拽右下角调整高度</span>
        <Button size="sm" variant="ghost" onClick={toggle} aria-pressed={expanded}>
          {expanded ? "收起" : "展开全高"}
        </Button>
      </div>
    </div>
  );
}
