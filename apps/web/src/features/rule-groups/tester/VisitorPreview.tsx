import type { PresentedMail } from "@maillink/shared";
import { formatBytes, isHttpUrl } from "../../mail";

function LoginLink({ url }: { url: string }) {
  if (!isHttpUrl(url)) return <span className="pv-link mono">{url}</span>;
  return <a className="pv-link mono" href={url} target="_blank" rel="noopener noreferrer">{url}</a>;
}

function senderLine(sender: PresentedMail["sender"]): string | null {
  if (!sender) return null;
  return [sender.name, sender.address ?? sender.domain].filter(Boolean).join(" · ");
}

function Attachments({ items }: { items: PresentedMail["attachments"] }) {
  if (!items || items.length === 0) return null;
  const text = items.map((a) => `${a.name}（${formatBytes(a.size)}${a.downloadable ? "，可下载" : ""}）`).join("、");
  return <span className="pv-line">附件：{text}</span>;
}

function hasContent(preview: PresentedMail): boolean {
  return [preview.code, preview.login_link, preview.subject, preview.snippet].some((value) => value !== undefined);
}

/** 访客视角预览：按规则组呈现配置裁剪后的列表项。全部按纯文本渲染（不链接化）；登录链接只有 http(s) 才是链接 */
export function VisitorPreview({ preview }: { preview: PresentedMail }) {
  const sender = senderLine(preview.sender);
  return (
    <div className="t-preview" aria-label="访客看到的样子">
      <small>访客看到的样子{preview.recipient ? ` · ${preview.recipient}` : ""}</small>
      {preview.locked ? <span className="field-hint">需要访客点击后才显示内容（取码方式为“点击取码”）</span> : null}
      {preview.code !== undefined ? <span className="pv-code" aria-label={`验证码 ${preview.code.split("").join(" ")}`}>{preview.code}</span> : null}
      {preview.login_link !== undefined ? <LoginLink url={preview.login_link} /> : null}
      {sender ? <span className="pv-line">{sender}</span> : null}
      {preview.subject !== undefined ? <span className="pv-subject">{preview.subject}</span> : null}
      {preview.snippet !== undefined ? <span className="pv-snippet">{preview.snippet}</span> : null}
      <Attachments items={preview.attachments} />
      {!hasContent(preview) && !preview.locked ? <span className="field-hint">这封邮件按当前呈现配置没有任何可显示的内容。</span> : null}
    </div>
  );
}
