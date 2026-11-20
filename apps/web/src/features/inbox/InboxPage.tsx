import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Inbox, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import type { MyMailbox, MyMailListItem } from "@maillink/shared";
import { myMailboxesQuery } from "../../api/queries-auth";
import { DESKTOP_MEDIA_QUERY } from "../../constants";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useNowSec } from "../../hooks/useNowSec";
import { describeError } from "../../lib/messages";
import { PageHeader } from "../../shell/PageHeader";
import { Button, Callout, EmptyState, ErrorCallout, Select } from "../../ui";
import { listItems } from "../mails/list-store";
import type { MailListState } from "../mails/list-store";
import { InboxDetail } from "./InboxDetail";
import { InboxList } from "./InboxList";
import { buildOptions, detailMailboxId, resolveScope, scopeUnavailableReason, viewHasDetail } from "./inbox-model";
import type { InboxScope } from "./inbox-model";
import { useInboxList } from "./useInboxList";

const routeApi = getRouteApi("/workspace/inbox");
const CLOCK_TICK_MS = 15_000;

/** 有没有可能出现详情：单个邮箱看它的视图；“全部”只要有任何一个能看详情的邮箱 */
function scopeHasDetail(scope: InboxScope, mailboxes: readonly MyMailbox[]): boolean {
  if (scope.kind === "mailbox") return viewHasDetail(scope.mailbox.view);
  return scope.kind === "all" && mailboxes.some((mailbox) => mailbox.available && viewHasDetail(mailbox.view));
}

function selectValue(scope: InboxScope): string {
  if (scope.kind === "all") return "all";
  return String(scope.kind === "mailbox" ? scope.mailbox.mailbox_id : scope.mailboxId);
}

type ToolbarProps = {
  scope: InboxScope;
  mailboxes: readonly MyMailbox[];
  refreshDisabled: boolean;
  refreshing: boolean;
  onSwitch: (value: string) => void;
  onRefresh: () => void;
};

/** 收件地址切换（含“全部”）：不可用的邮箱灰显；地址被规则组隐藏的只写“地址已隐藏” */
function Toolbar({ scope, mailboxes, refreshDisabled, refreshing, onSwitch, onRefresh }: ToolbarProps) {
  return (
    <div className="inbox-toolbar">
      <div className="field">
        <label className="field-label" htmlFor="inbox-mailbox">收件地址</label>
        <Select block id="inbox-mailbox" value={selectValue(scope)} onChange={(event) => onSwitch(event.target.value)}>
          {scope.kind === "missing" ? <option value={String(scope.mailboxId)} disabled>已不在授权里的邮箱</option> : null}
          {buildOptions(mailboxes).map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
          ))}
        </Select>
      </div>
      <Button onClick={onRefresh} disabled={refreshDisabled} busy={refreshing} busyLabel="刷新中…"><RefreshCw />刷新</Button>
    </div>
  );
}

function Blocked({ scope, reason, onAll }: { scope: InboxScope; reason: string; onAll: () => void }) {
  return (
    <Callout tone="warning" title="这里没有可显示的邮件"
      actions={scope.kind === "all" ? undefined : <button type="button" className="text-action" onClick={onAll}>查看全部邮箱</button>}>
      {reason}
    </Callout>
  );
}

function useInboxNavigation() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const mailboxPart = search.mailbox === undefined ? {} : { mailbox: search.mailbox };
  return {
    search,
    switchMailbox: (value: string) => void navigate({ search: value === "all" ? {} : { mailbox: Number(value) } }),
    select: (id: number | null) => void navigate({ search: id === null ? mailboxPart : { ...mailboxPart, id } }),
  };
}

function UnavailableNotice({ count, scope }: { count: number; scope: InboxScope }) {
  if (count === 0 || scope.kind !== "all") return null;
  return <Callout tone="warning" title={`有 ${count} 个邮箱暂时不可用`}>它们的显示规则出了问题，邮件暂时看不到，请联系管理员。下拉里已灰显。</Callout>;
}

type DetailProps = { selectedId: number | null; scope: InboxScope; list: MailListState<MyMailListItem>; onBack: () => void };

/** “全部”里深链接指向的邮件还没加载出来：先等列表，拿到它自带的 mailbox_id 再请求详情，避免请求两次 */
function waitingForList(scope: InboxScope, mailboxId: number | undefined, list: MailListState<MyMailListItem>): boolean {
  return scope.kind === "all" && mailboxId === undefined && list.pages.length === 0 && !list.hasError;
}

function DetailColumn({ selectedId, scope, list, onBack }: DetailProps) {
  const mailboxId = detailMailboxId(scope, listItems(list), selectedId);
  return (
    <section className="mail-detail-col" aria-label="邮件详情">
      {selectedId === null ? (
        <EmptyState icon={Inbox} title="选择一封邮件" description="在左侧列表里点一封邮件，这里显示它的内容。" />
      ) : waitingForList(scope, mailboxId, list) ? (
        <span className="skeleton mail-detail-skeleton" role="status" aria-label="正在加载邮件" />
      ) : (
        <InboxDetail key={`${mailboxId ?? "all"}-${selectedId}`} id={selectedId} mailboxId={mailboxId} onBack={onBack} />
      )}
    </section>
  );
}

function Workspace({ mailboxes }: { mailboxes: readonly MyMailbox[] }) {
  const { search, switchMailbox, select } = useInboxNavigation();
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const nowSec = useNowSec(CLOCK_TICK_MS);
  const scope = resolveScope(mailboxes, search.mailbox);
  const unavailable = scopeUnavailableReason(scope, mailboxes);
  const { store, state } = useInboxList(scope.kind === "mailbox" ? scope.mailbox.mailbox_id : undefined, unavailable === null);
  const showDetail = scopeHasDetail(scope, mailboxes);
  const selectedId = showDetail && unavailable === null ? (search.id ?? null) : null;

  // 窄屏进入详情后回到顶部（详情替换了列表）
  useEffect(() => {
    if (selectedId !== null && !isDesktop) window.scrollTo(0, 0);
  }, [selectedId, isDesktop]);

  return (
    <div className="mail-page inbox-page" data-view={selectedId === null ? "list" : "detail"} data-detail={showDetail ? "yes" : "none"}>
      <PageHeader title="我的邮件" summary={state.pages.length > 0 ? `已加载 ${listItems(state).length} 封` : undefined} />
      <Toolbar scope={scope} mailboxes={mailboxes} refreshDisabled={unavailable !== null} refreshing={state.busy === "first"}
        onSwitch={switchMailbox} onRefresh={() => store.refresh()} />
      <UnavailableNotice count={mailboxes.filter((mailbox) => !mailbox.available).length} scope={scope} />
      {unavailable !== null ? (
        <Blocked scope={scope} reason={unavailable} onAll={() => switchMailbox("all")} />
      ) : (
        <div className="mail-split">
          <section className="mail-list-col" aria-label="邮件列表">
            <div className="panel">
              <InboxList state={state} scope={scope} selectedId={selectedId} nowSec={nowSec}
                onSelect={select} onLoadMore={() => store.loadMore()} onRetry={() => store.retry()} />
            </div>
          </section>
          {showDetail ? <DetailColumn selectedId={selectedId} scope={scope} list={state} onBack={() => select(null)} /> : null}
        </div>
      )}
    </div>
  );
}

/** 我的邮件（05 §3）：收件地址切换（含“全部”）+ 列表 + 详情；窄屏列表 → 详情栈式 */
export function InboxPage() {
  const mailboxes = useQuery(myMailboxesQuery());
  if (mailboxes.isError) {
    return (
      <>
        <PageHeader title="我的邮件" />
        <ErrorCallout title="没能读取你的邮箱" {...describeError(mailboxes.error)} onRetry={() => void mailboxes.refetch()} />
      </>
    );
  }
  if (!mailboxes.data) {
    return (
      <>
        <PageHeader title="我的邮件" />
        <span className="skeleton" aria-label="加载中" />
      </>
    );
  }
  if (mailboxes.data.items.length === 0) {
    return (
      <>
        <PageHeader title="我的邮件" />
        <EmptyState icon={Inbox} title="还没有被分配邮箱" description="请联系管理员，为你的账号分配收件地址后，邮件会显示在这里。" />
      </>
    );
  }
  return <Workspace mailboxes={mailboxes.data.items} />;
}
