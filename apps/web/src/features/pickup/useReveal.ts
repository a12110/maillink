import { useEffect, useState } from "react";
import type { LinkPublicStatus } from "@maillink/shared";
import { classifyPickupError, describeMailError } from "./failures";
import type { InlineProblem } from "./failures";
import type { PickupMailStore } from "./mail-store";
import { effectiveRemaining } from "./mail-model";
import type { PickupApi } from "./pickup-api";

type Options = {
  token: string;
  api: Pick<PickupApi, "reveal">;
  store: PickupMailStore;
  status: LinkPublicStatus;
  /** 设备已满、每日上限、需重新开始等：交给页面重新取状态 */
  onBlocked: () => void;
};

const RELOAD_KINDS: ReadonlySet<string> = new Set(["daily_limit", "device_limit", "start_required"]);
const GONE_KINDS: ReadonlySet<string> = new Set(["unavailable", "not_found"]);

/**
 * 点击取码（reveal=click）：POST reveal → 用已显示的版本替换占位 → 用响应里的 deliveries 更新剩余次数。
 * 总次数用尽（total_remaining=0）后停止轮询并保留已显示的码（之后任何请求都是 410）。
 */
export function useReveal({ token, api, store, status, onBlocked }: Options) {
  const [deliveries, setDeliveries] = useState(status.deliveries);
  const [revealing, setRevealing] = useState<number | null>(null);
  const [problem, setProblem] = useState<InlineProblem | null>(null);
  useEffect(() => setDeliveries(status.deliveries), [status.deliveries]);

  const totalDone = deliveries?.total_remaining === 0;
  useEffect(() => {
    if (totalDone) store.stop("quota");
  }, [totalDone, store]);

  const reveal = async (id: number): Promise<boolean> => {
    setRevealing(id);
    setProblem(null);
    try {
      const result = await api.reveal(token, id);
      store.applyRevealed(result.mail);
      setDeliveries(result.deliveries);
      return true;
    } catch (error) {
      const kind = classifyPickupError(error).kind;
      if (RELOAD_KINDS.has(kind)) onBlocked();
      else if (GONE_KINDS.has(kind)) store.stop("gone");
      else setProblem(describeMailError(error));
      return false;
    } finally {
      setRevealing(null);
    }
  };

  const exhausted = status.reveal === "click" && effectiveRemaining(deliveries) === 0;
  return { deliveries, revealing, problem, exhausted, reveal };
}
