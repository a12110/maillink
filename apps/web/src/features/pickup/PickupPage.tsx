import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { LinkPublicStatus } from "@maillink/shared";
import { PickupMain, PickupShell } from "../../shell/PickupShell";
import type { PickupBrand } from "../../shell/PickupShell";
import { ActiveView } from "./ActiveView";
import { classifyPickupError } from "./failures";
import type { PageFailure } from "./failures";
import { useNowSeconds } from "./hooks";
import { DEFAULT_TITLE, RemainingTime, SiteNotice } from "./PickupHead";
import { pickupApi } from "./pickup-api";
import type { PickupApi } from "./pickup-api";
import type { TurnstileLoader } from "../turnstile/loader";
import { StartView } from "./StartView";
import {
  DailyLimitView,
  DeviceLimitView,
  LoadFailedView,
  NoMailboxView,
  NotFoundView,
  NotYetValidView,
  UnavailableView,
} from "./StateViews";

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; status: LinkPublicStatus }
  | { kind: "failed"; failure: PageFailure; last: LinkPublicStatus | null };

/** 页面带 noindex 与 no-referrer（取件页原型都带）；离开时移除，不影响管理端 */
function usePickupMeta(): void {
  useEffect(() => {
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex";
    const referrer = document.createElement("meta");
    referrer.name = "referrer";
    referrer.content = "no-referrer";
    document.head.append(robots, referrer);
    return () => {
      robots.remove();
      referrer.remove();
    };
  }, []);
}

/** 标题只含链接标题与站点名，绝不含 token */
function titleOf(phase: Phase): string {
  const status = phase.kind === "ready" ? phase.status : phase.kind === "failed" ? phase.last : null;
  const page = status?.public_title ?? DEFAULT_TITLE;
  const brand = status?.site.show_brand ? status.site.name : undefined;
  return brand ? `${page} · ${brand}` : page;
}

function brandOf(status: LinkPublicStatus | null): PickupBrand | undefined {
  if (status === null || !status.site.show_brand) return undefined;
  return { name: status.site.name, logo: status.site.logo };
}

/** 取件页状态机：先 GET 状态，再按 `state` 与错误码渲染对应视图 */
export function PickupPage({ token, api = pickupApi, turnstileLoader }: { token: string; api?: PickupApi; turnstileLoader?: TurnstileLoader }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const now = useNowSeconds();
  usePickupMeta();

  const load = useCallback(() => {
    let cancelled = false;
    api.status(token).then(
      (status) => {
        if (!cancelled) setPhase({ kind: "ready", status });
      },
      (error: unknown) => {
        if (!cancelled) setPhase((current) => ({ kind: "failed", failure: classifyPickupError(error), last: current.kind === "ready" ? current.status : null }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, token]);
  useEffect(() => load(), [load]);

  const title = titleOf(phase);
  useEffect(() => {
    document.title = title;
  }, [title]);

  const last = phase.kind === "ready" ? phase.status : phase.kind === "failed" ? phase.last : null;
  return (
    <PickupShell
      brand={brandOf(last)}
      wide={phase.kind === "ready" && phase.status.state === "active" && phase.status.view !== "code_only"}
      topRight={phase.kind === "ready" ? <TopRight status={phase.status} now={now} /> : undefined}
    >
      <PageBody phase={phase} token={token} api={api} turnstileLoader={turnstileLoader} title={title} onReload={() => void load()} onStatus={(status) => setPhase({ kind: "ready", status })} />
    </PickupShell>
  );
}

function TopRight({ status, now }: { status: LinkPublicStatus; now: number }) {
  if (status.state === "needs_start") return <span>首次使用</span>;
  if (status.state === "active") return <RemainingTime status={status} now={now} />;
  return null;
}

type BodyProps = {
  phase: Phase;
  token: string;
  api: PickupApi;
  turnstileLoader?: TurnstileLoader;
  title: string;
  onReload: () => void;
  onStatus: (status: LinkPublicStatus) => void;
};

const NEEDS_START_ERROR = new Error("这台设备还没有开始取码，请刷新页面");

type FailureOf<K extends PageFailure["kind"]> = Extract<PageFailure, { kind: K }>;
type Ctx = { last: LinkPublicStatus | null; onReload: () => void };

/** 失败 → 视图：不存在 / 已失效 / 未生效 / 设备已满 / 每日上限 / 没有地址 / 其他（带原因与重试） */
const FAILURE_VIEWS: { [K in PageFailure["kind"]]: (failure: FailureOf<K>, ctx: Ctx) => ReactNode } = {
  not_found: () => <NotFoundView />,
  unavailable: () => <UnavailableView />,
  not_yet_valid: (failure) => <NotYetValidView validFrom={failure.validFrom} />,
  no_mailbox: () => <NoMailboxView />,
  device_limit: (failure, { last }) => <DeviceLimitView publicNote={failure.publicNote ?? last?.public_note ?? null} />,
  daily_limit: (failure, { last }) => (
    <DailyLimitView retryAfterAt={failure.retryAfterAt} dailyLimit={last?.deliveries?.daily_limit ?? null} publicNote={last?.public_note ?? null} />
  ),
  start_required: (_failure, { onReload }) => <LoadFailedView error={NEEDS_START_ERROR} onRetry={onReload} />,
  other: (failure, { onReload }) => <LoadFailedView error={failure.error} onRetry={onReload} />,
};

function FailureBody({ failure, ...ctx }: { failure: PageFailure } & Ctx) {
  const render = FAILURE_VIEWS[failure.kind] as (failure: PageFailure, ctx: Ctx) => ReactNode;
  return <>{render(failure, ctx)}</>;
}

function PageBody({ phase, token, api, turnstileLoader, title, onReload, onStatus }: BodyProps) {
  if (phase.kind === "loading") {
    return (
      <PickupMain>
        <span className="skeleton" style={{ width: "60%", height: 28 }} aria-label="正在加载" role="status" />
        <span className="skeleton" style={{ width: "40%" }} aria-hidden="true" />
      </PickupMain>
    );
  }
  if (phase.kind === "failed") {
    return (
      <PickupMain>
        <FailureBody failure={phase.failure} last={phase.last} onReload={onReload} />
      </PickupMain>
    );
  }
  const { status } = phase;
  switch (status.state) {
    case "needs_start":
      return <StartView token={token} status={status} api={api} turnstileLoader={turnstileLoader} onStarted={onStatus} onBlocked={onReload} />;
    case "active":
      return <ActiveView token={token} status={status} api={api} baseTitle={title} onBlocked={onReload} />;
    case "device_limit":
      return (
        <PickupMain>
          <SiteNotice notice={status.site.notice} />
          <DeviceLimitView publicNote={status.public_note} />
        </PickupMain>
      );
    case "daily_limit":
      return (
        <PickupMain>
          <SiteNotice notice={status.site.notice} />
          <DailyLimitView retryAfterAt={status.retry_after_at} dailyLimit={status.deliveries?.daily_limit ?? null} publicNote={status.public_note} />
        </PickupMain>
      );
    case "no_mailbox":
      return (
        <PickupMain>
          <NoMailboxView />
        </PickupMain>
      );
  }
}
