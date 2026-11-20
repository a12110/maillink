import { Fragment } from "react";
import type { LinkPublicStatus } from "@maillink/shared";
import { Callout } from "../../ui";
import { formatRemaining } from "./time";

export const DEFAULT_TITLE = "取验证码";

/** 站点公告：纯文本，保留换行（不渲染 HTML） */
export function SiteNotice({ notice }: { notice: string | undefined }) {
  if (notice === undefined || notice.trim() === "") return null;
  return (
    <Callout tone="info" title="公告">
      <span className="pk-pre">{notice}</span>
    </Callout>
  );
}

export function PickupTitle({ status, lead }: { status: LinkPublicStatus; lead?: string | null }) {
  return (
    <div>
      <h1 className="pk-title">{status.public_title ?? DEFAULT_TITLE}</h1>
      {lead ? <p className="pk-lead pk-pre">{lead}</p> : null}
    </div>
  );
}

/** 长别名允许折行，折行点放在 `@` 之前 */
function Address({ value }: { value: string }) {
  const at = value.indexOf("@");
  if (at < 0) return <>{value}</>;
  return (
    <>
      {value.slice(0, at)}
      <wbr />
      {value.slice(at)}
    </>
  );
}

/** 收件地址（已按规则打码；口令通过前为空，不显示）。多个地址时附总数 */
export function AddressBlock({ status }: { status: LinkPublicStatus }) {
  if (status.mailboxes.length === 0) return null;
  const more = status.mailbox_count > status.mailboxes.length;
  return (
    <div>
      <div className="pk-addr-label">{status.mailboxes.length > 1 ? "登录邮箱（多个）" : "登录邮箱"}</div>
      {status.mailboxes.map((address) => (
        <Fragment key={address}>
          <div className="pk-addr">
            <Address value={address} />
          </div>
        </Fragment>
      ))}
      {more ? <div className="pk-addr-label">共 {status.mailbox_count} 个地址</div> : null}
    </div>
  );
}

/** 顶栏右侧：剩余有效时间；没有有效期不显示 */
export function RemainingTime({ status, now }: { status: LinkPublicStatus; now: number }) {
  if (status.expires_at === null) return null;
  const left = formatRemaining(status.expires_at, now);
  return (
    <span>
      {left === null ? (
        "已到期"
      ) : (
        <>
          剩余有效 <b className="num">{left}</b>
        </>
      )}
    </span>
  );
}
