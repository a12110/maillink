import type { LinkPublicStatus } from "@maillink/shared";
import { TOAST_DURATION_MS } from "../../constants";
import { Callout } from "../../ui";
import { CodeView } from "./CodeView";
import { useNowSeconds, usePickupCopy } from "./hooks";
import { LiveStatus, ResumeButton } from "./LiveStatus";
import { ListView } from "./ListView";
import { AddressBlock, PickupTitle, SiteNotice } from "./PickupHead";
import type { PickupApi } from "./pickup-api";
import { useReveal } from "./useReveal";
import { useArrivalNotice, usePickupMails } from "./usePickupMails";

type ActiveViewProps = {
  token: string;
  status: LinkPublicStatus;
  api: PickupApi;
  baseTitle: string;
  /** 设备已满、每日上限、需重新开始等：交给页面重新取状态 */
  onBlocked: () => void;
};

function Head({ status }: { status: LinkPublicStatus }) {
  return (
    <>
      <SiteNotice notice={status.site.notice} />
      <PickupTitle status={status} lead={status.public_note} />
      <AddressBlock status={status} />
    </>
  );
}

/** 已登记访客的取码页：轮询邮件，按规则组视图决定显示验证码卡片还是列表 + 详情 */
export function ActiveView({ token, status, api, baseTitle, onBlocked }: ActiveViewProps) {
  const now = useNowSeconds();
  const { store, state } = usePickupMails(token, api, status.poll_interval_sec);
  const { freshIds, announcement } = useArrivalNotice(state.arrival, baseTitle);
  const { copy, message } = usePickupCopy(TOAST_DURATION_MS);
  const { deliveries, revealing, problem, exhausted, reveal } = useReveal({ token, api, store, status, onBlocked });

  const summary = state.items.length === 0 || status.view === "code_only" ? "正在等待新邮件" : `${state.items.length} 封邮件`;
  const liveStatus = (
    <>
      {problem ? (
        <Callout tone="danger" title="取码失败">
          {problem.message}（{problem.detail}）
        </Callout>
      ) : null}
      <LiveStatus state={state} store={store} summary={summary} />
    </>
  );
  const resume = state.paused === "idle" && state.stopped === null ? <ResumeButton state={state} store={store} /> : null;
  const common = { items: state.items, deliveries, now, freshIds, loaded: state.loaded, head: <Head status={status} />, status: liveStatus, resume, reveal, revealing, exhausted };
  return (
    <>
      {status.view === "code_only" ? (
        <CodeView {...common} copy={copy} />
      ) : (
        <ListView {...common} token={token} api={api} hasDetail={status.view !== "meta_only"} hasOlder={state.nextCursor !== null} onLoadOlder={() => store.loadOlder()} />
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {message ? (
        <div className="pk-toast" role="status" aria-live="polite" data-tone={message.tone}>
          {message.text}
        </div>
      ) : null}
    </>
  );
}
