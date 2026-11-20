import { useEffect, useRef, useState } from "react";
import { PICKUP_TICK_MS } from "../../constants";
import { nowSeconds } from "./time";

/** 每秒更新的当前时间（Unix 秒）：倒计时、“32 秒前”、剩余有效时间共用 */
export function useNowSeconds(): number {
  const [now, setNow] = useState(nowSeconds);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowSeconds()), PICKUP_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** 到时间自动消失的提示（复制成功 / 失败）；每次 show 重置计时 */
export function useFlash(durationMs: number) {
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const show = (text: string, tone: "ok" | "error") => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setMessage({ text, tone });
    timer.current = window.setTimeout(() => setMessage(null), durationMs);
  };
  return { message, show };
}

export const COPY_FAILED_MESSAGE = "复制失败，请长按验证码选择复制";

/** 复制：成功提示“已复制”，失败明确提示并让用户长按选择，不假装成功 */
export function usePickupCopy(flashMs: number) {
  const flash = useFlash(flashMs);
  const copy = async (text: string, doneMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash.show(doneMessage, "ok");
    } catch {
      flash.show(COPY_FAILED_MESSAGE, "error");
    }
  };
  return { copy, message: flash.message };
}
