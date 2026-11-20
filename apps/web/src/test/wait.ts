import { act } from "react";

const POLL_MS = 5;
const DEFAULT_TIMEOUT_MS = 2000;

/** 轮询直到条件成立（在 act 里推进异步更新）；超时抛错并带上说明，不静默通过 */
export async function waitUntil(predicate: () => boolean, what: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`等待超时：${what}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    });
  }
}
