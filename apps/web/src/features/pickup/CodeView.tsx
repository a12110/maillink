import { Copy, ExternalLink, Lock, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { LinkDeliveryQuota, PresentedMail } from "@maillink/shared";
import { PICKUP_OLDER_CODES_SHOWN, PICKUP_STALE_CODE_SEC } from "../../constants";

import { PickupBar, PickupMain } from "../../shell/PickupShell";
import { Button, Tag } from "../../ui";
import { isHttpUrl } from "../mail";
import type { ExhaustedKind } from "./mail-model";
import { kindOf, linkDomain, originOf, quotaLines, remainingSuffix, speakCode } from "./mail-model";
import { formatAgo, isStale } from "./time";

const SEC_PER_MINUTE = 60;

type Actions = {
  copy: (text: string, doneMessage: string) => Promise<void>;
  reveal: (id: number) => Promise<boolean>;
  /** 正在取码的邮件 id */
  revealing: number | null;
  /** 点击取码已无次数可用（总次数 / 仅每日） */
  exhausted: ExhaustedKind;
};

type CodeViewProps = Actions & {
  items: readonly PresentedMail[];
  deliveries: LinkDeliveryQuota | null;
  now: number;
  freshIds: ReadonlySet<number>;
  loaded: boolean;
  /** 标题、地址、公告等页头内容 */
  head: ReactNode;
  /** 状态行（倒计时 / 补全 / 暂停…）与暂停时的底部“继续刷新” */
  status: ReactNode;
  resume: ReactNode;
};

function metaLine(mail: PresentedMail, now: number, suffix?: string) {
  const origin = originOf(mail);
  return (
    <p className="pk-meta">
      <b>{formatAgo(mail.received_at, now)}</b>
      {origin ? ` · 来自 ${origin}` : ""}
      {suffix ? ` · ${suffix}` : ""}
    </p>
  );
}

/** 由 PICKUP_STALE_CODE_SEC 换算，改常量文案跟着变：「10 分钟」 */
export function staleMinutesText(): string {
  return `${Math.round(PICKUP_STALE_CODE_SEC / SEC_PER_MINUTE)} 分钟`;
}

function StaleTag({ mail, now }: { mail: PresentedMail; now: number }) {
  return isStale(mail.received_at, now, PICKUP_STALE_CODE_SEC) ? <Tag tone="warning">收到超过 {staleMinutesText()}，可能已过期</Tag> : null;
}

function LatestCard({ mail, now, fresh }: { mail: PresentedMail; now: number; fresh: boolean }) {
  const kind = kindOf(mail);
  const origin = originOf(mail);
  const labelId = `pk-latest-${mail.id}`;
  const title = kind === "link" ? "登录链接" : "验证码";
  return (
    <section className="pk-code-card" aria-labelledby={labelId} data-fresh={fresh ? "true" : undefined}>
      <div className="pk-platform" id={labelId}>
        <span className="dot" data-tone="success" aria-hidden="true" />
        {origin ? `${origin} ${title}` : title}
        {fresh ? <Tag tone="success">刚收到</Tag> : null}
      </div>
      {kind === "code" ? (
        <output className="pk-code" aria-live="off" aria-label={`验证码 ${speakCode(mail.code ?? "")}`}>
          {mail.code}
        </output>
      ) : (
        <LinkDomain link={mail.login_link ?? ""} />
      )}
      {metaLine(mail, now)}
      <StaleTag mail={mail} now={now} />
      {kind === "link" ? (
        <p className="pk-note pk-link-warning">
          <b>这个链接等于一次登录。</b>只在你自己的设备上打开，不要转发给别人。页面只显示它会打开的网站，不显示完整地址。
        </p>
      ) : null}
    </section>
  );
}

function LinkDomain({ link }: { link: string }) {
  const domain = linkDomain(link);
  return (
    <p className="pk-link-domain">
      <Lock />
      {domain ?? "（无法识别的链接）"}
    </p>
  );
}

function LockedLatest({ mails, deliveries, now }: { mails: readonly PresentedMail[]; deliveries: LinkDeliveryQuota | null; now: number }) {
  const newest = mails[0] as PresentedMail;
  const origin = originOf(newest);
  return (
    <>
      <section className="pk-code-card" role="status">
        <div className="pk-platform">
          <span className="dot" data-tone="success" aria-hidden="true" />
          有 {mails.length} 封新邮件
        </div>
        <p className="pk-locked-title">{origin ? `${origin} 发来的邮件` : "收到新邮件"}</p>
        <p className="pk-meta">
          <b>{formatAgo(newest.received_at, now)}</b> · 点开才会显示验证码
        </p>
      </section>
      {quotaLines(deliveries).length > 0 ? (
        <p className="pk-note">
          {quotaLines(deliveries).join("；")}。同一封邮件重复查看不重复计次。
        </p>
      ) : null}
    </>
  );
}

function OlderValue({ mail }: { mail: PresentedMail }) {
  const kind = kindOf(mail);
  if (kind === "code") return <span className="code" aria-label={`验证码 ${speakCode(mail.code ?? "")}`}>{mail.code}</span>;
  if (kind === "link") return <span className="code pk-old-domain">{linkDomain(mail.login_link ?? "") ?? "（无法识别的链接）"}</span>;
  return <span className="code pk-old-locked">{kind === "locked" ? "未查看" : "没有验证码"}</span>;
}

function OlderAction({ mail, actions }: { mail: PresentedMail; actions: Actions }) {
  const kind = kindOf(mail);
  const copyText = kind === "code" ? mail.code : kind === "link" && isHttpUrl(mail.login_link ?? "") ? mail.login_link : undefined;
  if (copyText !== undefined) {
    const done = kind === "code" ? `已复制 ${copyText}` : "已复制登录链接";
    return (
      <Button size="sm" variant="secondary" onClick={() => void actions.copy(copyText, done)}>
        <Copy />
        复制
      </Button>
    );
  }
  if (kind !== "locked") return null;
  return (
    <Button size="sm" variant="secondary" disabled={actions.exhausted !== null || actions.revealing !== null} onClick={() => void actions.reveal(mail.id)}>
      查看
    </Button>
  );
}

function OlderRow({ mail, now, actions }: { mail: PresentedMail; now: number; actions: Actions }) {
  const stale = isStale(mail.received_at, now, PICKUP_STALE_CODE_SEC);
  const origin = originOf(mail);
  return (
    <div className="pk-old" data-stale={stale ? "true" : undefined}>
      <div className="info">
        <OlderValue mail={mail} />
        <span>
          {formatAgo(mail.received_at, now)}
          {origin ? ` · 来自 ${origin}` : ""}
        </span>
        <StaleTag mail={mail} now={now} />
      </div>
      <OlderAction mail={mail} actions={actions} />
    </div>
  );
}

function MoreLocked({ mails, deliveries, actions }: { mails: readonly PresentedMail[]; deliveries: LinkDeliveryQuota | null; actions: Actions }) {
  const next = mails[0];
  if (next === undefined) return null;
  return (
    <div className="pk-old">
      <div className="info">
        <span className="code pk-old-locked">还有 {mails.length} 封更早的邮件未查看</span>
        <span>每查看一封计 1 次{remainingSuffix(deliveries)}</span>
      </div>
      <Button size="sm" variant="secondary" disabled={actions.exhausted !== null || actions.revealing !== null} onClick={() => void actions.reveal(next.id)}>
        查看
      </Button>
    </div>
  );
}

function Waiting() {
  return (
    <section className="pk-state" role="status">
      <span className="icon-wrap">
        <RefreshCw className="icon-lg" />
      </span>
      <h2>正在等待新邮件</h2>
      <p>去登录页点“发送验证码”，一般 10–60 秒内到达。</p>
    </section>
  );
}

/** 底部通栏：按"最新一条"的形态决定主操作 */
function CodeBar({ latest, deliveries, actions, resume }: { latest: PresentedMail | undefined; deliveries: LinkDeliveryQuota | null; actions: Actions; resume: ReactNode }) {
  if (resume) return <PickupBar>{resume}</PickupBar>;
  if (latest === undefined) return null;
  const kind = kindOf(latest);
  if (kind === "locked") {
    return (
      <PickupBar>
        <Button variant="primary" size="lg" block disabled={actions.exhausted !== null} busy={actions.revealing === latest.id} busyLabel="正在取码…" onClick={() => void actions.reveal(latest.id)}>
          查看验证码{remainingSuffix(deliveries)}
        </Button>
      </PickupBar>
    );
  }
  if (kind === "code") {
    return (
      <PickupBar>
        <Button variant="primary" size="lg" block onClick={() => void actions.copy(latest.code ?? "", `已复制 ${latest.code}`)}>
          <Copy />
          复制验证码
        </Button>
      </PickupBar>
    );
  }
  if (kind === "link") {
    const link = latest.login_link ?? "";
    return (
      <PickupBar row>
        {isHttpUrl(link) ? (
          <a className="btn" data-variant="primary" data-size="lg" href={link} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
            打开登录链接
          </a>
        ) : null}
        <Button variant="secondary" size="lg" onClick={() => void actions.copy(link, "已复制登录链接")}>
          <Copy />
          复制链接
        </Button>
      </PickupBar>
    );
  }
  return null;
}

/** `code_only` 视图：最新验证码 / 登录链接大卡 + 更早收到的弱化小卡 + 底部通栏主操作 */
export function CodeView(props: CodeViewProps) {
  const { items, deliveries, now, freshIds, loaded, actions, head, status, resume } = splitProps(props);
  const { latest, lockedItems, olderLocked, older } = pickCards(items, PICKUP_OLDER_CODES_SHOWN);
  return (
    <>
      <PickupMain>
        {head}
        <Latest loaded={loaded} latest={latest} lockedItems={lockedItems} deliveries={deliveries} now={now} fresh={latest !== undefined && freshIds.has(latest.id)} />
        {older.length > 0 || olderLocked.length > 0 ? (
          <>
            <h2 className="pk-section-label">更早收到的</h2>
            <div className="pk-stack">
              {older.map((mail) => (
                <OlderRow key={mail.id} mail={mail} now={now} actions={actions} />
              ))}
              <MoreLocked mails={olderLocked} deliveries={deliveries} actions={actions} />
            </div>
          </>
        ) : null}
        {status}
      </PickupMain>
      <CodeBar latest={latest} deliveries={deliveries} actions={actions} resume={resume} />
    </>
  );
}

type LatestProps = { loaded: boolean; latest: PresentedMail | undefined; lockedItems: readonly PresentedMail[]; deliveries: LinkDeliveryQuota | null; now: number; fresh: boolean };

function Latest({ loaded, latest, lockedItems, deliveries, now, fresh }: LatestProps) {
  if (!loaded) {
    return (
      <section className="pk-code-card" aria-hidden="true">
        <span className="skeleton pk-skel-label" />
        <span className="skeleton pk-skel-code" />
        <span className="skeleton pk-skel-meta" />
      </section>
    );
  }
  if (latest === undefined) return <Waiting />;
  const linkBlocked = kindOf(latest) === "link" && !isHttpUrl(latest.login_link ?? "");
  return (
    <>
      {kindOf(latest) === "locked" ? <LockedLatest mails={lockedItems} deliveries={deliveries} now={now} /> : <LatestCard mail={latest} now={now} fresh={fresh} />}
      {linkBlocked ? <p className="pk-note">这个登录链接不是 http(s) 地址，已禁止打开。</p> : null}
    </>
  );
}

/**
 * 最新一条：最新的非空邮件若还没取（点击取码）就是“有 N 封新邮件”卡片，否则是最新的一条有码 / 有链接的邮件。
 * 比最新一条更早、还没取的邮件不逐条列出（会很吵），合并成一行“还有 N 封更早的邮件未查看”。
 */
function pickCards(items: readonly PresentedMail[], olderMax: number) {
  const nonEmpty = items.filter((mail) => kindOf(mail) !== "empty");
  const shown = nonEmpty.filter((mail) => kindOf(mail) !== "locked");
  const locked = nonEmpty.filter((mail) => kindOf(mail) === "locked");
  const lockedFirst = nonEmpty[0] !== undefined && kindOf(nonEmpty[0]) === "locked";
  return {
    latest: lockedFirst ? nonEmpty[0] : shown[0],
    lockedItems: locked,
    olderLocked: lockedFirst ? [] : locked,
    older: (lockedFirst ? shown : shown.slice(1)).slice(0, olderMax),
  };
}

function splitProps(props: CodeViewProps) {
  const { copy, reveal, revealing, exhausted, ...rest } = props;
  return { ...rest, actions: { copy, reveal, revealing, exhausted } };
}
