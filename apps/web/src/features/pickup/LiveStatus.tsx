import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { MS_PER_SECOND, PARTIAL_RETRY_DELAYS_MS } from "../../constants";
import { describeMailError } from "./failures";
import { Button, Callout } from "../../ui";
import type { MailStoreState, PickupMailStore } from "./mail-store";
import { useNowSeconds } from "./hooks";

type LiveStatusProps = {
  state: MailStoreState;
  store: PickupMailStore;
  /** 状态行的主文案，如“正在等待新邮件”“5 封邮件” */
  summary: ReactNode;
  /** 链接 / 次数 / 设备已不可用时的补充说明（已显示的内容保留） */
  stoppedNote?: ReactNode;
};

const STOP_TITLE = {
  quota: "取码次数已用完，已停止刷新",
  gone: "链接已失效，已停止刷新",
  needs_start: "这台设备的登录状态已失效",
} as const;

const STOP_BODY = {
  quota: "已显示的内容保留在本页，需要更多次数请联系卖家。",
  gone: "已显示的内容保留在本页。",
  needs_start: "请刷新页面，重新点击“开始取码”。",
} as const;

function PollError({ error }: { error: unknown }) {
  const { message, detail } = describeMailError(error);
  return (
    <Callout tone="warning" title="刷新失败，稍后会自动重试">
      {message}（{detail}）
    </Callout>
  );
}

function countdownText(state: MailStoreState, now: number): string {
  if (state.busy) return "正在刷新…";
  if (state.nextPollAt === null) return "即将刷新";
  return `${Math.max(0, Math.ceil(state.nextPollAt / MS_PER_SECOND - now))} 秒后自动刷新`;
}

/** 状态行：自动刷新倒计时 / partial 补全 / 补全失败 / 暂停 / 停止。已显示的内容始终保留，不闪烁 */
export function LiveStatus({ state, store, summary, stoppedNote }: LiveStatusProps) {
  const now = useNowSeconds();
  if (state.stopped !== null) {
    return (
      <Callout tone="info" title={STOP_TITLE[state.stopped]}>
        {stoppedNote ?? STOP_BODY[state.stopped]}
      </Callout>
    );
  }
  if (state.paused === "idle") {
    return (
      <Callout tone="warning" title="自动刷新已暂停">
        有一会儿没有操作，为省流量先停了。点下面的“继续刷新”。
      </Callout>
    );
  }
  if (state.partial?.exhausted) {
    return (
      <div className="pk-retry">
        <Callout tone="danger" title="邮件没有加载完整（PARTIAL）">
          已自动重试 {PARTIAL_RETRY_DELAYS_MS.length} 次仍未成功。页面会继续按正常间隔刷新，你也可以现在重试。
        </Callout>
        <Button size="lg" variant="secondary" onClick={() => store.refresh()}>
          <RefreshCw />
          重试
        </Button>
      </div>
    );
  }
  if (state.partial) {
    return (
      <div className="pk-live" role="status" aria-busy="true">
        <span className="pulse" aria-hidden="true" />
        <span className="grow">
          正在补全邮件（第 {state.partial.attempt} 次，共 {PARTIAL_RETRY_DELAYS_MS.length} 次），不需要你操作
        </span>
      </div>
    );
  }
  return (
    <>
      {state.error ? <PollError error={state.error} /> : null}
      <div className="pk-live" role="status">
        <span className="pulse" aria-hidden="true" />
        <span className="grow">
          <b>{summary}</b> · {countdownText(state, now)}
        </span>
        <Button size="sm" variant="ghost" disabled={state.busy} onClick={() => store.refresh()}>
          <RefreshCw />
          立即刷新
        </Button>
      </div>
    </>
  );
}

/** 底部“继续刷新”（无操作暂停后）。返回 null 表示当前不需要 */
export function ResumeButton({ state, store }: { state: MailStoreState; store: PickupMailStore }) {
  if (state.paused !== "idle" || state.stopped !== null) return null;
  return (
    <Button variant="primary" size="lg" block onClick={() => store.setIdle(false)}>
      <RefreshCw />
      继续刷新
    </Button>
  );
}
