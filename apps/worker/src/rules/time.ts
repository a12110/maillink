import type { TimeConfig } from "@maillink/shared";

// 有效时间下界（02 §3.1）：各来源取最大值，下推进 SQL（created_at >= ?）。全部为 Unix 秒。

const SECONDS_PER_MINUTE = 60;

export type TimeAnchors = {
  /** 链接或授权的创建时间 */
  created_at: number;
  /** 首次"开始取码"的时间；尚未激活时为 null */
  first_access_at: number | null;
  /** share_links.anchor_reset_at；授权没有这一项，传 null */
  anchor_reset_at: number | null;
};

/**
 * 来源：
 *   - window_minutes：now − N 分钟；
 *   - subject_created：max(created_at, anchor_reset_at) − lookback；
 *   - first_access：max(first_access_at ?? now, anchor_reset_at) − lookback（首次访问前没有锚点，用 now）；
 *   - fixed：max(at, anchor_reset_at)；
 *   - none：anchor_reset_at（设了才有）。
 * anchor_reset_at 在 fixed / none 下也生效是实现补充：管理员明确"重置起始时间"（售后换号）时，
 * 不论规则组用哪种起始方式，都不应让买家看到重置之前的邮件。
 * 没有任何来源时返回 null，表示没有时间下界。
 */
export function computeTimeLowerBound(time: TimeConfig, anchors: TimeAnchors, now: number): number | null {
  assertSeconds("now", now);
  assertSeconds("created_at", anchors.created_at);
  if (anchors.first_access_at !== null) assertSeconds("first_access_at", anchors.first_access_at);
  if (anchors.anchor_reset_at !== null) assertSeconds("anchor_reset_at", anchors.anchor_reset_at);
  const candidates: number[] = [];
  if (time.window_minutes !== undefined) candidates.push(now - time.window_minutes * SECONDS_PER_MINUTE);
  const since = sinceBound(time.since, anchors, now);
  if (since !== null) candidates.push(since);
  return candidates.length === 0 ? null : Math.max(...candidates);
}

function sinceBound(since: TimeConfig["since"], anchors: TimeAnchors, now: number): number | null {
  const reset = anchors.anchor_reset_at;
  const lookback = (since.lookback_minutes ?? 0) * SECONDS_PER_MINUTE;
  switch (since.type) {
    case "subject_created":
      return laterOf(anchors.created_at, reset) - lookback;
    case "first_access":
      return laterOf(anchors.first_access_at ?? now, reset) - lookback;
    case "fixed":
      if (since.at === undefined) throw new Error("since.type=fixed 缺少 at（配置应在校验时被拒绝）");
      return laterOf(since.at, reset);
    case "none":
      return reset;
  }
}

function laterOf(anchor: number, reset: number | null): number {
  return reset === null ? anchor : Math.max(anchor, reset);
}

function assertSeconds(name: string, value: number): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} 必须是整数 Unix 秒，实际是 ${value}`);
}

/** 求值时再判一次（纵深防御：SQL 已经按下界过滤过） */
export function isWithinWindow(receivedAt: number, lowerBound: number | null): boolean {
  return lowerBound === null || receivedAt >= lowerBound;
}
