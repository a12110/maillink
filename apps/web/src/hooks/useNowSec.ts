import { useEffect, useState } from "react";
import { nowSeconds } from "../lib/format";

/** 当前时间（Unix 秒），每隔 intervalMs 刷新一次，用于“多久之前”这类相对时间 */
export function useNowSec(intervalMs: number): number {
  const [now, setNow] = useState(nowSeconds);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowSeconds()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
