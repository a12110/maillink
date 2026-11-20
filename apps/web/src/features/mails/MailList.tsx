import { Inbox, MailSearch, Paperclip } from "lucide-react";
import type { AdminMailListItem } from "@maillink/shared";
import { PARTIAL_RETRY_DELAYS_MS } from "../../constants";
import { formatDateTime } from "../../lib/format";
import { describeError } from "../../lib/messages";
import { Button, Callout, EmptyState, Tag } from "../../ui";
import { CATEGORY_LABEL, formatSender } from "../mail";
import { listItems, nextCursorOf } from "./list-store";
import type { MailListState } from "./list-store";

const SKELETON_ITEMS = 8;

function senderText(item: AdminMailListItem): { text: string; dim: boolean } {
  const sender = formatSender(item.sender);
  if (sender !== null) return { text: sender, dim: false };
  return { text: item.envelope === null ? "—" : `信封：${item.envelope}`, dim: true };
}

function subjectText(item: AdminMailListItem): string {
  if (item.parse_status === "pending") return "（正在解析）";
  if (item.subject === null) return "（解析失败，没有主题）";
  return item.subject === "" ? "（无主题）" : item.subject;
}

function Badges({ item }: { item: AdminMailListItem }) {
  if (item.parse_status === "failed") return <Tag tone="warning">解析失败</Tag>;
  if (item.parse_status === "pending") return <Tag tone="info">解析中</Tag>;
  return (
    <>
      {item.code ? <span className="mail-code mono">{item.code}</span> : null}
      {item.category && item.category !== "other" ? <Tag>{CATEGORY_LABEL[item.category]}</Tag> : null}
      {item.has_attachment ? <Paperclip aria-label="有附件" /> : null}
    </>
  );
}

type MailRowProps = { item: AdminMailListItem; selected: boolean; onSelect: (id: number) => void };

function MailRow({ item, selected, onSelect }: MailRowProps) {
  const sender = senderText(item);
  return (
    <li>
      <button
        type="button"
        className="mail-item"
        data-mail-id={item.id}
        data-status={item.parse_status}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(item.id)}
      >
        <span className="mail-item-line">
          <span className="mail-item-subject" data-dim={item.subject === null}>
            {subjectText(item)}
          </span>
          <span className="mail-item-time num">{formatDateTime(item.received_at)}</span>
        </span>
        <span className="mail-item-line">
          <span className="mail-item-who">
            <span data-dim={sender.dim}>{sender.text}</span>
            <span className="mono"> → {item.recipient}</span>
          </span>
          <span className="mail-item-badges">
            <Badges item={item} />
          </span>
        </span>
      </button>
    </li>
  );
}

function SkeletonList() {
  return (
    <ul className="mail-list" aria-busy="true" aria-label="正在加载邮件">
      {Array.from({ length: SKELETON_ITEMS }, (_, index) => (
        <li key={index} className="mail-item mail-item-skeleton" aria-hidden="true">
          <span className="skeleton" />
          <span className="skeleton" />
        </li>
      ))}
    </ul>
  );
}

type PartialNoticeProps = { state: MailListState; onRetry: () => void };

/** partial 重取的进度（静默）与用尽后的失败提示（不吞错） */
function PartialNotice({ state, onRetry }: PartialNoticeProps) {
  const { partial } = state;
  if (partial === null || state.hasError) return null;
  if (!partial.exhausted) {
    return (
      <p className="mail-partial-status" role="status">
        正在补全邮件（第 {partial.attempt} 次，共 {PARTIAL_RETRY_DELAYS_MS.length} 次），不需要你操作
      </p>
    );
  }
  return (
    <div className="mail-list-notice">
      <Callout
        tone="danger"
        title="邮件没有加载完整"
        actions={
          <button type="button" className="text-action" onClick={onRetry}>
            重试
          </button>
        }
      >
        有邮件重取 {PARTIAL_RETRY_DELAYS_MS.length} 次后仍未解析完成，列表里标“解析中”的邮件内容暂时不全。
      </Callout>
    </div>
  );
}

type MailListProps = {
  state: MailListState;
  selectedId: number | null;
  filtered: boolean;
  onSelect: (id: number) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onClearFilters: () => void;
};

function ListError({ state, onRetry }: { state: MailListState; onRetry: () => void }) {
  if (!state.hasError) return null;
  const { message, detail } = describeError(state.error);
  return (
    <div className="mail-list-notice">
      <Callout
        tone="danger"
        title="邮件列表加载失败"
        actions={
          <button type="button" className="text-action" onClick={onRetry}>
            重试
          </button>
        }
      >
        {message}（{detail}）
      </Callout>
    </div>
  );
}

function ListFoot({ state, count, onLoadMore }: { state: MailListState; count: number; onLoadMore: () => void }) {
  const canLoadMore = nextCursorOf(state) !== null;
  const more = state.pages.at(-1)?.nextCursor !== null;
  const waiting = more && !canLoadMore && state.busy === null && state.partial !== null;
  return (
    <div className="mail-list-foot">
      <span className="num">已加载 {count} 封{more ? "" : "，已到最后"}</span>
      {more ? (
        <Button
          size="sm"
          onClick={onLoadMore}
          disabled={!canLoadMore && state.busy !== "more"}
          busy={state.busy === "more"}
          busyLabel="加载中…"
          title={waiting ? "这一页还在补全，补全后才能继续加载" : undefined}
        >
          加载更多
        </Button>
      ) : null}
    </div>
  );
}

export function MailList(props: MailListProps) {
  const { state, selectedId, filtered } = props;
  const items = listItems(state);
  const loaded = state.pages.length > 0;
  if (!loaded && state.hasError) return <ListError state={state} onRetry={props.onRetry} />;
  if (!loaded) return <SkeletonList />;
  if (items.length === 0) {
    return filtered ? (
      <EmptyState
        icon={MailSearch}
        title="没有符合筛选的邮件"
        description="换个条件，或清除筛选再看看。"
        action={<Button onClick={props.onClearFilters}>清除筛选</Button>}
      />
    ) : (
      <EmptyState icon={Inbox} title="还没有邮件" description="邮件库里暂时没有邮件；有新邮件入库后点“刷新”。" />
    );
  }
  return (
    <>
      <ListError state={state} onRetry={props.onRetry} />
      <PartialNotice state={state} onRetry={props.onRetry} />
      <ul className="mail-list" aria-label="邮件列表">
        {items.map((item) => (
          <MailRow key={item.id} item={item} selected={item.id === selectedId} onSelect={props.onSelect} />
        ))}
      </ul>
      <ListFoot state={state} count={items.length} onLoadMore={props.onLoadMore} />
    </>
  );
}
