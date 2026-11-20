import { Copy, ExternalLink, Lock } from "lucide-react";
import type { PresentedMail } from "@maillink/shared";
import { Button, Tag } from "../../ui";
import { useCopy } from "../mail/useCopy";
import { loginLinkHost, presentedSender } from "./inbox-model";
import { formatAgo, isStaleCode } from "./time-ago";

type Props = { mail: PresentedMail; nowSec: number; latest: boolean };

/** 验证码逐位读出：“4 8 2 9 1 0”，屏幕阅读器不会把它当成一个大数 */
function spokenCode(code: string): string {
  return Array.from(code).join(" ");
}

function LoginLink({ link }: { link: string }) {
  const { copy, error } = useCopy();
  const host = loginLinkHost(link);
  return (
    <div className="code-link">
      <p className="code-link-host mono"><Lock aria-hidden="true" />{host ?? "（无法识别的链接）"}</p>
      <p className="field-hint">这个链接等于一次登录，只在你自己的设备上打开，不要转发。</p>
      <div className="form-actions">
        {host === null ? null : (
          // 只有 http(s) 才渲染成链接（PLAN 硬性要求 5）；完整地址不显示，只显示它会打开的域名
          <a className="btn" data-variant="primary" href={link} target="_blank" rel="noopener noreferrer">
            <ExternalLink />打开登录链接
          </a>
        )}
        <Button onClick={() => void copy(link, "链接已复制")}><Copy />复制链接</Button>
      </div>
      {error ? <p className="field-error">复制失败：{error}</p> : null}
    </div>
  );
}

/** code_only 视图：一张卡 = 一封邮件的验证码（大号等宽）+ 复制 + 来源与多久之前；超过 10 分钟的弱化并标注 */
export function CodeCard({ mail, nowSec, latest }: Props) {
  const { copy, error } = useCopy();
  const stale = isStaleCode(mail.received_at, nowSec);
  const sender = presentedSender(mail.sender);
  return (
    <article className="code-card" data-latest={latest} data-stale={stale} aria-label={`验证码，${formatAgo(mail.received_at, nowSec)}收到`}>
      <p className="code-card-meta">
        <span>{sender === null ? "来源未显示" : `来自 ${sender}`}</span>
        <span className="num">{formatAgo(mail.received_at, nowSec)}</span>
        {stale ? <Tag tone="warning">收到超过 10 分钟，可能已过期</Tag> : null}
      </p>
      {mail.code === undefined ? null : (
        <>
          <p className="code-card-code mono" aria-label={`验证码 ${spokenCode(mail.code)}`}>{mail.code}</p>
          <Button variant={latest ? "primary" : "secondary"} size={latest ? "lg" : "md"} onClick={() => void copy(mail.code ?? "", "验证码已复制")}>
            <Copy />复制验证码
          </Button>
          {error ? <p className="field-error">复制失败，请长按验证码选择复制（{error}）</p> : null}
        </>
      )}
      {mail.login_link === undefined ? null : <LoginLink link={mail.login_link} />}
    </article>
  );
}
