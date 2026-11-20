import { Mail } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import type { LinkDeliveryQuota, PresentedMail } from "@maillink/shared";
import { PickupBar, PickupMain } from "../../shell/PickupShell";
import { Button, Tag } from "../../ui";
import type { ExhaustedKind } from "./mail-model";
import { originOf, remainingSuffix } from "./mail-model";
import { PickupMailDetail } from "./PickupMailDetail";
import type { PickupApi } from "./pickup-api";
import { formatAgo } from "./time";

type ListViewProps = {
  token: string;
  api: Pick<PickupApi, "detail">;
  /** meta_only：只有列表，没有详情 */
  hasDetail: boolean;
  items: readonly PresentedMail[];
  deliveries: LinkDeliveryQuota | null;
  now: number;
  freshIds: ReadonlySet<number>;
  loaded: boolean;
  head: ReactNode;
  status: ReactNode;
  resume: ReactNode;
  reveal: (id: number) => Promise<boolean>;
  revealing: number | null;
  exhausted: ExhaustedKind;
  hasOlder: boolean;
  onLoadOlder: () => void;
};

type ItemProps = {
  mail: PresentedMail;
  now: number;
  selected: boolean;
  fresh: boolean;
  deliveries: LinkDeliveryQuota | null;
  interactive: boolean;
  disabled: boolean;
  onOpen: (mail: PresentedMail) => void;
};

function ItemBody({ mail, now, fresh, deliveries }: Pick<ItemProps, "mail" | "now" | "fresh" | "deliveries">) {
  const origin = originOf(mail) ?? "未知发件人";
  if (mail.locked === true) {
    return (
      <>
        <span className="l1">
          <span className="from">{origin}</span>
          {fresh ? <Tag tone="success">刚收到</Tag> : null}
          <span className="when">{formatAgo(mail.received_at, now)}</span>
        </span>
        <span className="subj">有 1 封新邮件，点击查看{remainingSuffix(deliveries)}</span>
      </>
    );
  }
  return (
    <>
      <span className="l1">
        <span className="from">{origin}</span>
        {fresh ? <Tag tone="success">刚收到</Tag> : null}
        <span className="when">{formatAgo(mail.received_at, now)}</span>
      </span>
      <span className="subj">{mail.subject === undefined || mail.subject === "" ? "（无主题）" : mail.subject}</span>
      {mail.snippet ? <span className="snip">{mail.snippet}</span> : null}
    </>
  );
}

function Item(props: ItemProps) {
  const { mail, selected, fresh, interactive, disabled, onOpen } = props;
  const locked = mail.locked === true;
  // 列表项只在“可展开详情”或“需要点击取码”时是按钮；meta_only 且已显示的是静态行
  if (!interactive && !locked) {
    return (
      <li>
        <div className="pk-item" data-fresh={fresh ? "true" : undefined}>
          <ItemBody {...props} />
        </div>
      </li>
    );
  }
  return (
    <li>
      <button type="button" className="pk-item" data-locked={locked ? "true" : undefined} data-fresh={fresh ? "true" : undefined} aria-current={selected ? "true" : undefined} disabled={disabled} onClick={() => onOpen(mail)}>
        <ItemBody {...props} />
      </button>
    </li>
  );
}

function Empty({ loaded }: { loaded: boolean }) {
  if (!loaded) {
    return (
      <div className="pk-list-wrap" aria-busy="true">
        <span className="skeleton pk-skel-row" />
      </div>
    );
  }
  return (
    <section className="pk-state" role="status">
      <span className="icon-wrap">
        <Mail className="icon-lg" />
      </span>
      <h2>还没有邮件</h2>
      <p>去登录页点“发送验证码”，一般 10–60 秒内到达。</p>
    </section>
  );
}

type ColumnProps = Pick<ListViewProps, "items" | "deliveries" | "now" | "freshIds" | "loaded" | "status" | "revealing" | "exhausted" | "hasOlder" | "onLoadOlder" | "hasDetail"> & {
  selected: number | null;
  onOpen: (mail: PresentedMail) => void;
};

function ListColumn(props: ColumnProps) {
  const { items, deliveries, now, freshIds, loaded, status, exhausted, revealing } = props;
  return (
    <div className="pk-list-col">
      {status}
      {items.length === 0 ? (
        <Empty loaded={loaded} />
      ) : (
        <div className="pk-list-wrap">
          <ul className="pk-list">
            {items.map((mail) => (
              <Item
                key={mail.id}
                mail={mail}
                now={now}
                selected={mail.id === props.selected}
                fresh={freshIds.has(mail.id)}
                deliveries={deliveries}
                interactive={props.hasDetail}
                disabled={mail.locked === true && (exhausted !== null || revealing !== null)}
                onOpen={props.onOpen}
              />
            ))}
          </ul>
        </div>
      )}
      {props.hasOlder ? (
        <Button variant="secondary" block onClick={props.onLoadOlder}>
          加载更早的邮件
        </Button>
      ) : null}
    </div>
  );
}

/** `text` / `full` / `meta_only` 视图：列表 + 详情。≥1024 并排，窄屏栈式（列表 → 详情） */
export function ListView(props: ListViewProps) {
  const { token, api, hasDetail, items, now, head, resume } = props;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = hasDetail && items.some((mail) => mail.id === selectedId && mail.locked !== true) ? selectedId : null;

  // 点击取码的邮件先取码（计一次），成功后再展开详情；meta_only 没有详情，取码后就地显示
  const open = async (mail: PresentedMail) => {
    if (mail.locked === true && !(await props.reveal(mail.id))) return;
    if (!hasDetail) return;
    setSelectedId(mail.id);
    window.scrollTo(0, 0);
  };

  return (
    <>
      <PickupMain>
        {head}
        <div className="pk-split" data-view={selected === null ? "list" : "detail"}>
          <ListColumn {...props} selected={selected} onOpen={(mail) => void open(mail)} />
          {hasDetail ? (
            <div className="pk-detail">
              {selected !== null ? (
                <PickupMailDetail key={selected} token={token} id={selected} api={api} now={now} onBack={() => setSelectedId(null)} />
              ) : (
                <p className="pk-empty-detail">选择左侧的一封邮件查看详情</p>
              )}
            </div>
          ) : null}
        </div>
      </PickupMain>
      {resume ? <PickupBar>{resume}</PickupBar> : null}
    </>
  );
}
