import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PresentedMail } from "@maillink/shared";
import { PARTIAL_RETRY_DELAYS_MS, PICKUP_FRESH_TAG_MS, PICKUP_IDLE_PAUSE_MS, PICKUP_VIBRATE_MS } from "../../constants";
import { PickupMailStore } from "./mail-store";
import type { MailStoreState } from "./mail-store";
import { kindOf, speakCode } from "./mail-model";
import type { PickupApi } from "./pickup-api";

/** 活动事件的节流：同一秒内的多次移动只续一次空闲计时 */
const ACTIVITY_THROTTLE_MS = 1000;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "touchstart", "scroll"] as const;

/**
 * 邮件轮询。后台时照常轮询（新邮件到达才能在标题上提示）；无操作一段时间（含一直在后台）后暂停，给“继续刷新”；
 * 回到前台：因后台而暂停的自动恢复（用户回来了），否则立即刷新一次。离开页面销毁。
 */
export function usePickupMails(token: string, api: Pick<PickupApi, "mails">, intervalSec: number) {
  const store = useMemo(
    () => new PickupMailStore((query) => api.mails(token, query), PARTIAL_RETRY_DELAYS_MS, intervalSec),
    // 轮询间隔变化（重新取状态）只更新 store，不重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, api],
  );
  useEffect(() => store.setIntervalSec(intervalSec), [store, intervalSec]);
  useEffect(() => {
    store.start();
    let idleTimer: number | null = null;
    let armedAt = 0;
    let idleWhileHidden = false;
    const arm = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      armedAt = Date.now();
      idleTimer = window.setTimeout(() => {
        idleWhileHidden = document.hidden;
        store.setIdle(true);
      }, PICKUP_IDLE_PAUSE_MS);
    };
    const onActivity = () => {
      // 已因无操作暂停后，前台里的任何活动都不自动恢复：必须点“继续刷新”
      if (store.getSnapshot().paused === "idle") return;
      if (Date.now() - armedAt >= ACTIVITY_THROTTLE_MS) arm();
    };
    const onVisibility = () => {
      if (document.hidden) return;
      if (store.getSnapshot().paused === "idle" && idleWhileHidden) {
        store.setIdle(false);
        arm();
      } else {
        store.refresh();
      }
    };
    arm();
    document.addEventListener("visibilitychange", onVisibility);
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true });
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      store.dispose();
    };
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { store, state };
}

type Arrival = MailStoreState["arrival"];

function announcementFor(mails: readonly PresentedMail[]): string {
  const code = mails.find((mail) => kindOf(mail) === "code")?.code;
  if (code !== undefined) return `收到新验证码 ${speakCode(code)}`;
  if (mails.some((mail) => kindOf(mail) === "link")) return "收到新的登录链接";
  if (mails.every((mail) => mail.locked === true)) return `有 ${mails.length} 封新邮件，点击查看`;
  return `收到 ${mails.length} 封新邮件`;
}

/**
 * 新邮件到达的可感知提示（DESIGN.md 取件页规则）：“刚收到”标签 4s、aria-live 朗读、后台时标题前缀、可选震动。
 * 淡入与底色渐退由 CSS 做（减少动效时去位移）。
 */
export function useArrivalNotice(arrival: Arrival, baseTitle: string) {
  const [freshIds, setFreshIds] = useState<ReadonlySet<number>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const seen = useRef(0);
  const titleRef = useRef(baseTitle);
  titleRef.current = baseTitle;
  useEffect(() => {
    if (arrival === null || arrival.seq === seen.current) return;
    seen.current = arrival.seq;
    setFreshIds(new Set(arrival.mails.map((mail) => mail.id)));
    setAnnouncement(announcementFor(arrival.mails));
    if (document.hidden) document.title = `(新) 验证码 · ${titleRef.current}`;
    // 震动：仅当用户已操作过页面且设备支持；不支持就跳过，不发声
    if (navigator.userActivation?.hasBeenActive && typeof navigator.vibrate === "function") navigator.vibrate(PICKUP_VIBRATE_MS);
    const timer = window.setTimeout(() => setFreshIds(new Set()), PICKUP_FRESH_TAG_MS);
    return () => window.clearTimeout(timer);
  }, [arrival]);
  useEffect(() => {
    const restore = () => {
      if (!document.hidden) document.title = baseTitle;
    };
    document.addEventListener("visibilitychange", restore);
    return () => document.removeEventListener("visibilitychange", restore);
  }, [baseTitle]);
  return { freshIds, announcement };
}
