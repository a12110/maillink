import { Inbox, Paperclip } from "lucide-react";
import type { MyMailListItem } from "@maillink/shared";
import { PARTIAL_RETRY_DELAYS_MS } from "../../constants";
import { formatDateTime } from "../../lib/format";
import { describeError } from "../../lib/messages";
import { isApiError } from "../../api/errors";
import { Button, Callout, EmptyState } from "../../ui";
import { listItems, nextCursorOf } from "../mails/list-store";
import type { MailListState } from "../mails/list-store";
import { CodeCard } from "./CodeCard";
import { canOpenDetail, isCodeItem, presentedSender } from "./inbox-model";
import type { InboxScope } from "./inbox-model";

const SKELETON_ITEMS = 6;

type RowProps = { mail: MyMailListItem; selected: boolean; openable: boolean; onSelect: (id: number) => void };

function RowBody({ mail }: { mail: MyMailListItem }) {
  const sender = presentedSender(mail.sender);
  return (
    <>
      <span className="mail-item-line">
        <span className="mail-item-subject">{mail.subject === undefined ? "（主题已隐藏）" : mail.subject || "（无主题）"}</span>
        <span className="mail-item-time num">{formatDateTime(mail.received_at)}</span>
      </span>
      <span className="mail-item-line">
        <span className="mail-item-who">
          {sender ?? "发件人已隐藏"}
          {mail.recipient === undefined ? null : <span className="mono"> → {mail.recipient}</span>}
        </span>
        <span className="mail-item-badges">{mail.attachments && mail.attachments.length > 0 ? <Paperclip aria-label="有附件" /> : null}</span>
      </span>
      {mail.snippet ? <span className="mail-item-snippet">{mail.snippet}</span> : null}
    </>
  );
}

/** 没有详情入口的视图（meta_only）：只读行，不是按钮，键盘与读屏都不会把它当成可点的 */
function MailRow({ mail, selected, openable, onSelect }: RowProps) {
  return (
    <li>
      {openable ? (
        <button type="button" className="mail-item" data-mail-id={mail.id} aria-current={selected ? "true" : undefined} onClick={() => onSelect(mail.id)}>
          <RowBody mail={mail} />
        </button>
      ) : (
        <div className="mail-item" data-mail-id={mail.id} data-static="true">
          <RowBody mail={mail} />
        </div>
      )}
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

function Notices({ state, scope, onRetry }: { state: MailListState<MyMailListItem>; scope: InboxScope; onRetry: () => void }) {
  const content = noticeContent({ state, scope, onRetry });
  return content === null ? null : <div className="mail-list-notice">{content}</div>;
}

function noticeContent({ state, scope, onRetry }: { state: MailListState<MyMailListItem>; scope: InboxScope; onRetry: () => void }) {
  if (state.hasError) {
    if (isApiError(state.error, "too_many_scopes") && scope.kind === "all") {
      return <Callout tone="warning" title="邮箱太多，没法合并显示">你被授权的邮箱规则组组合太多，请在上方选择一个具体的邮箱查看。</Callout>;
    }
    const { message, detail } = describeError(state.error);
    return (
      <Callout tone="danger" title="邮件列表加载失败" actions={<button type="button" className="text-action" onClick={onRetry}>重试</button>}>
        {message}（{detail}）
      </Callout>
    );
  }
  const { partial } = state;
  if (partial === null) return null;
  if (!partial.exhausted) {
    return <p className="mail-partial-status" role="status">正在补全邮件（第 {partial.attempt} 次，共 {PARTIAL_RETRY_DELAYS_MS.length} 次），不需要你操作</p>;
  }
  return (
    <Callout tone="danger" title="邮件没有加载完整" actions={<button type="button" className="text-action" onClick={onRetry}>重试</button>}>
      重取 {PARTIAL_RETRY_DELAYS_MS.length} 次后仍有邮件没解析完，列表可能不全。
    </Callout>
  );
}

type Props = {
  state: MailListState<MyMailListItem>;
  scope: InboxScope;
  selectedId: number | null;
  nowSec: number;
  onSelect: (id: number) => void;
  onLoadMore: () => void;
  onRetry: () => void;
};

export function InboxList({ state, scope, selectedId, nowSec, onSelect, onLoadMore, onRetry }: Props) {
  const items = listItems(state);
  const loaded = state.pages.length > 0;
  const notices = <Notices state={state} scope={scope} onRetry={onRetry} />;
  if (!loaded) return state.hasError ? notices : <SkeletonList />;
  if (items.length === 0 && state.partial === null) {
    return <EmptyState icon={Inbox} title="还没有邮件" description="这个范围内暂时没有你能看到的邮件；有新邮件后点“刷新”。" />;
  }
  const hasMore = (state.pages.at(-1)?.nextCursor ?? null) !== null;
  const canLoadMore = nextCursorOf(state) !== null;
  return (
    <>
      {notices}
      <ul className="mail-list" aria-label="邮件列表" data-cards={items.some(isCodeItem)}>
        {items.map((mail, index) =>
          isCodeItem(mail) ? (
            <li key={mail.id}><CodeCard mail={mail} nowSec={nowSec} latest={index === 0} /></li>
          ) : (
            <MailRow key={mail.id} mail={mail} selected={mail.id === selectedId} openable={canOpenDetail(mail)} onSelect={onSelect} />
          ),
        )}
      </ul>
      {hasMore ? (
        <div className="mail-list-foot">
          <span className="num">已加载 {items.length} 封</span>
          <Button size="sm" onClick={onLoadMore} disabled={!canLoadMore && state.busy !== "more"} busy={state.busy === "more"} busyLabel="加载中…">
            加载更多
          </Button>
        </div>
      ) : null}
    </>
  );
}
